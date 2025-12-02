// Initialize Firebase
const firebaseConfig = {
    apiKey: "AIzaSyAZBx_u3YwqeU9oKD99UBmoLme8rkTTz04",
    authDomain: "expensestracker-50d70.firebaseapp.com",
    databaseURL: "https://expensestracker-50d70-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "expensestracker-50d70",
    storageBucket: "expensestracker-50d70.firebasestorage.app",
    messagingSenderId: "1056704392093",
    appId: "1:1056704392093:web:ac53134df3586e4f7d1d74",
    measurementId: "G-PHLPXF1XPT"
};

// Initialize Firebase (if not already initialized)
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const database = firebase.database();

// Check authentication
let currentUser = null;
const userStr = localStorage.getItem('user');
if (userStr) {
    currentUser = JSON.parse(userStr);
} else {
    // Redirect to login if not authenticated
    window.location.href = 'auth.html';
}

// Initialize app
let transactions = JSON.parse(localStorage.getItem('transactions')) || [];
let sevenDayChart = null;
// Filter state
let activeFilters = {};
// Chart windowing state
let chartStartIndex = 0;
let chartVisibleCount = 7;
let chartTotalBars = 0;
let chartAllLabels = [];
let chartAllData = [];
// Current selected date range
let currentDateRange = null;

// Budget Management Functions (matching desktop database structure)
function saveBudgetForDateRange(dateRange, budget) {
    // Get existing budgets array from localStorage
    let budgets = JSON.parse(localStorage.getItem('budgets')) || [];
    
    // Find existing entry for this date range
    const existingIndex = budgets.findIndex(b => b.date_range === dateRange);
    
    const budgetEntry = {
        date_range: dateRange,
        budget: parseFloat(budget) || 0,
        saved_at: new Date().toISOString()
    };
    
    if (existingIndex >= 0) {
        // Update existing entry
        budgets[existingIndex] = budgetEntry;
    } else {
        // Add new entry
        budgets.push(budgetEntry);
    }
    
    // Save back to localStorage
    localStorage.setItem('budgets', JSON.stringify(budgets));
    
    // Sync to Firebase if signed in
    if (currentUser && currentUser.uid) {
        syncBudgetToFirebase(dateRange, budgetEntry);
    }
}

function getBudgetForDateRange(dateRange) {
    const budgets = JSON.parse(localStorage.getItem('budgets')) || [];
    const entry = budgets.find(b => b.date_range === dateRange);
    return entry ? entry.budget : 0;
}

function getAllBudgetDateRanges() {
    const budgets = JSON.parse(localStorage.getItem('budgets')) || [];
    // Sort by saved_at descending (most recent first)
    return budgets.sort((a, b) => new Date(b.saved_at) - new Date(a.saved_at));
}

// Firebase Sync Functions
function syncBudgetToFirebase(dateRange, budgetEntry) {
    if (!currentUser || !currentUser.uid) return;
    
    const dateRangeId = dateRange.replace(/ /g, '_').replace(/\//g, '-');
    
    // Match desktop app structure exactly
    const budgetData = {
        budget: budgetEntry.budget || 0,
        date_range: dateRange,
        remaining: budgetEntry.remaining || 0,
        total_spend: budgetEntry.total_spend || 0,
        progress: budgetEntry.progress || 0,
        categories: budgetEntry.categories || '',
        bar_values: budgetEntry.bar_values || '',
        no_budget: budgetEntry.no_budget || 0,
        saved_at: budgetEntry.saved_at || new Date().toISOString(),
        start_index: budgetEntry.start_index || 0,
        visible_count: budgetEntry.visible_count || 7
    };
    
    database.ref(`users/${currentUser.uid}/budgets/${dateRangeId}`).set(budgetData)
        .then(() => console.log('✓ Budget synced to Firebase:', dateRangeId))
        .catch(err => console.error('Firebase sync error:', err));
}

function syncTransactionsToFirebase(dateRange, transactions) {
    if (!currentUser || !currentUser.uid) return;
    
    const dateRangeId = dateRange.replace(/ /g, '_').replace(/\//g, '-');
    const filteredTransactions = transactions.filter(t => t.dateRange === dateRange);
    
    // Match desktop app structure - array of expense objects
    const expensesData = filteredTransactions.map((t, index) => ({
        row_index: index,
        date: t.date,
        name: t.name,
        amount: t.amount,
        category: t.category || '',
        note: t.note || ''
    }));
    
    database.ref(`users/${currentUser.uid}/expenses/${dateRangeId}`).set(expensesData)
        .then(() => console.log('✓ Expenses synced to Firebase:', expensesData.length))
        .catch(err => console.error('Firebase sync error:', err));
}

function loadDataFromFirebase() {
    if (!currentUser || !currentUser.uid) {
        console.log('Not signed in, skipping Firebase load');
        return;
    }
    
    console.log('Loading data from Firebase for user:', currentUser.uid);
    
    // Load budgets
    database.ref(`users/${currentUser.uid}/budgets`).once('value')
        .then(snapshot => {
            if (snapshot.exists()) {
                const firebaseBudgets = snapshot.val();
                const budgetArray = Object.keys(firebaseBudgets).map(key => {
                    const b = firebaseBudgets[key];
                    return {
                        date_range: b.date_range,
                        budget: b.budget,
                        saved_at: b.saved_at,
                        remaining: b.remaining,
                        total_spend: b.total_spend,
                        progress: b.progress,
                        categories: b.categories,
                        bar_values: b.bar_values,
                        no_budget: b.no_budget,
                        start_index: b.start_index,
                        visible_count: b.visible_count
                    };
                });
                
                localStorage.setItem('budgets', JSON.stringify(budgetArray));
                console.log('✓ Loaded budgets from Firebase:', budgetArray.length);
                
                // Refresh budget display if on page
                if (typeof updateBudgetDisplay === 'function') {
                    updateBudgetDisplay();
                }
            } else {
                console.log('No budgets found in Firebase');
            }
        })
        .catch(err => console.error('Error loading budgets:', err));
    
    // Load all expenses
    database.ref(`users/${currentUser.uid}/expenses`).once('value')
        .then(snapshot => {
            if (snapshot.exists()) {
                const firebaseExpenses = snapshot.val();
                let allTransactions = [];
                
                // Convert Firebase structure to web app format
                Object.keys(firebaseExpenses).forEach(dateRangeId => {
                    const dateRangeExpenses = firebaseExpenses[dateRangeId];
                    const dateRange = dateRangeId.replace(/_/g, ' ').replace(/-/g, '/');
                    
                    if (Array.isArray(dateRangeExpenses)) {
                        dateRangeExpenses.forEach(exp => {
                            allTransactions.push({
                                id: Date.now() + Math.random(),
                                date: exp.date,
                                name: exp.name,
                                amount: parseFloat(exp.amount),
                                category: exp.category || '',
                                note: exp.note || '',
                                dateRange: dateRange,
                                type: exp.amount < 0 ? 'expense' : 'income'
                            });
                        });
                    }
                });
                
                localStorage.setItem('transactions', JSON.stringify(allTransactions));
                transactions = allTransactions;
                console.log('✓ Loaded transactions from Firebase:', allTransactions.length);
                
                // Refresh display
                setTimeout(() => {
                    if (typeof renderTransactionsList === 'function') {
                        renderTransactionsList();
                    }
                    if (typeof updateDashboard === 'function') {
                        updateDashboard();
                    }
                    if (typeof renderTransactionsTable === 'function') {
                        renderTransactionsTable();
                    }
                }, 500);
            } else {
                console.log('No expenses found in Firebase');
            }
        })
        .catch(err => console.error('Error loading expenses:', err));
}

// Currency settings
let currentCurrency = 'USD';
const currencySymbols = {
    'USD': '$',
    'EUR': '€',
    'GBP': '£',
    'INR': '₹'
};

// Format currency based on current setting
function formatCurrency(amount) {
    const symbol = currencySymbols[currentCurrency] || '$';
    return `${symbol}${Math.abs(amount).toFixed(2)}`;
}

// Load currency setting from localStorage
function loadCurrencySetting() {
    const settingsStr = localStorage.getItem('settings');
    if (settingsStr) {
        try {
            const settings = JSON.parse(settingsStr);
            if (settings.currency) {
                currentCurrency = settings.currency;
            }
        } catch (e) {
            console.error('Error loading currency setting:', e);
        }
    }
}

// Reposition Add Expense Modal on left side of button
function repositionAddExpenseModal() {
    const btn = document.getElementById('addExpenseBtn');
    const modal = document.getElementById('addExpenseModal');
    const modalContent = modal.querySelector('.modal-content');
    
    if (!btn || !modal) return;
    
    const btnRect = btn.getBoundingClientRect();
    const modalRect = modalContent.getBoundingClientRect();
    
    // Position modal to the left of button
    let left = btnRect.left - 350 - 8;
    let top = btnRect.top + (btn.offsetHeight - 40) / 2;
    
    // Adjust if modal goes off-screen left - position on right side instead
    if (left < 10) {
        left = btnRect.right + 8;
    }
    
    // Adjust if modal goes off-screen right
    if (left + 350 > window.innerWidth - 10) {
        left = window.innerWidth - 350 - 10;
    }
    
    // Adjust if modal goes off-screen bottom
    if (top + 400 > window.innerHeight - 10) {
        top = window.innerHeight - 400 - 10;
    }
    
    // Adjust if modal goes off-screen top
    if (top < 10) {
        top = 10;
    }
    
    modalContent.style.left = left + 'px';
    modalContent.style.top = top + 'px';
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    // Load currency setting first
    loadCurrencySetting();
    
    // Set today's date as default
    const expenseDateEl = document.getElementById('expenseDate');
    if (expenseDateEl) {
        expenseDateEl.valueAsDate = new Date();
    }

    // Modal Controls
    const addExpenseBtn = document.getElementById('addExpenseBtn');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const cancelExpenseBtn = document.getElementById('cancelExpenseBtn');
    const addExpenseModal = document.getElementById('addExpenseModal');
    const addExpenseForm = document.getElementById('addExpenseForm');

    // Filter popover elements
    const filterBtn = document.getElementById('filterBtn');
    const filterPopover = document.getElementById('filterPopover');
    const filterForm = document.getElementById('filterForm');
    const applyFilterBtn = document.getElementById('applyFilter');
    const clearFilterBtn = document.getElementById('clearFilter');

    if (filterBtn && filterPopover) {
        filterBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            filterPopover.classList.toggle('active');
            filterPopover.setAttribute('aria-hidden', String(!filterPopover.classList.contains('active')));
        });

        // Close button handler
        const closeFilterBtn = document.getElementById('closeFilterBtn');
        if (closeFilterBtn) {
            closeFilterBtn.addEventListener('click', (e) => {
                e.preventDefault();
                filterPopover.classList.remove('active');
                filterPopover.setAttribute('aria-hidden', 'true');
            });
        }

        // Close when clicking outside
        document.addEventListener('click', (ev) => {
            if (!filterPopover.contains(ev.target) && ev.target !== filterBtn) {
                filterPopover.classList.remove('active');
                filterPopover.setAttribute('aria-hidden', 'true');
            }
        });

        // Escape key closes
        document.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') {
                filterPopover.classList.remove('active');
                filterPopover.setAttribute('aria-hidden', 'true');
            }
        });
    }

    if (applyFilterBtn && filterForm) {
        applyFilterBtn.addEventListener('click', () => {
            const form = new FormData(filterForm);
            const fromDate = form.get('fromDate') || '';
            const toDate = form.get('toDate') || '';
            const category = form.get('category') || '';
            const type = form.get('type') || '';
            const minAmount = form.get('minAmount') ? parseFloat(form.get('minAmount')) : null;
            const maxAmount = form.get('maxAmount') ? parseFloat(form.get('maxAmount')) : null;

            activeFilters = { fromDate, toDate, category, type, minAmount, maxAmount };
            filterPopover.classList.remove('active');
            filterPopover.setAttribute('aria-hidden', 'true');
            renderTransactionsTable();
        });
    }

    if (clearFilterBtn && filterForm) {
        clearFilterBtn.addEventListener('click', () => {
            filterForm.reset();
            activeFilters = {};
            renderTransactionsTable();
        });
    }

    if (addExpenseBtn) {
        addExpenseBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const modal = document.getElementById('addExpenseModal');
            modal.classList.toggle('active');
            if (modal.classList.contains('active')) {
                repositionAddExpenseModal();
            }
        });
    }

    // Close modal when clicking outside
    document.addEventListener('click', (e) => {
        const modal = document.getElementById('addExpenseModal');
        const btn = document.getElementById('addExpenseBtn');
        if (modal && btn && !modal.contains(e.target) && !btn.contains(e.target)) {
            modal.classList.remove('active');
        }
    });

    // Reposition modal on window resize
    window.addEventListener('resize', () => {
        const modal = document.getElementById('addExpenseModal');
        if (modal && modal.classList.contains('active')) {
            repositionAddExpenseModal();
        }
    });

    // Mobile side menu toggle
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const mobileSideMenu = document.getElementById('mobileSideMenu');
    const mobileSideOverlay = document.getElementById('mobileSideOverlay');
    const closeMobileMenu = document.getElementById('closeMobileMenu');

    function openMobileMenu() {
        if (!mobileSideMenu) return;
        mobileSideMenu.classList.add('active');
        mobileSideMenu.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
    }

    function closeMobileSide() {
        if (!mobileSideMenu) return;
        mobileSideMenu.classList.remove('active');
        mobileSideMenu.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
    }

    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openMobileMenu();
        });
    }

    if (mobileSideOverlay) {
        mobileSideOverlay.addEventListener('click', () => closeMobileSide());
    }

    if (closeMobileMenu) {
        closeMobileMenu.addEventListener('click', () => closeMobileSide());
    }

    // Close mobile menu on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeMobileSide();
    });

    // Wire mobile menu item actions to existing header buttons if present
    const mobileExportBtn = document.getElementById('mobileExportBtn');
    const mobileSettingsBtn = document.getElementById('mobileSettingsBtn');
    const mobileAboutBtn = document.getElementById('mobileAboutBtn');

    if (mobileExportBtn) mobileExportBtn.addEventListener('click', () => { closeMobileSide(); openMobileExportScreen(); });
    if (mobileSettingsBtn) mobileSettingsBtn.addEventListener('click', () => { closeMobileSide(); openMobileSettingsScreen(); });
    if (mobileAboutBtn) mobileAboutBtn.addEventListener('click', () => { closeMobileSide(); openMobileAboutScreen(); });

    // Populate mobile-side menu profile info and make header clickable
    const mobileProfileMenu = document.getElementById('mobileProfileMenu');
    const mobileProfileNameEl = document.getElementById('mobileProfileName');
    const mobileProfileEmailEl = document.getElementById('mobileProfileEmail');
    const mobileTotalTransactionsEl = document.getElementById('mobileTotalTransactions');

    if (mobileTotalTransactionsEl) {
        mobileTotalTransactionsEl.textContent = transactions.length;
    }

    if (mobileProfileMenu) {
        mobileProfileMenu.addEventListener('click', (e) => {
            e.stopPropagation();
            closeMobileSide();
            openMobileProfileScreen();
        });
    }

    // Settings modal
    const settingsModal = document.getElementById('settingsModal');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    const settingsForm = document.getElementById('settingsForm');
    const resetSettingsBtn = document.getElementById('resetSettingsBtn');
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');

    // Get desktop settings button
    const desktopSettingsBtn = document.querySelector('button[title="Settings"]');

    if (desktopSettingsBtn) {
        desktopSettingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openSettingsModal(desktopSettingsBtn);
        });
    }

    // Close when clicking outside
    document.addEventListener('click', (ev) => {
        if (settingsModal && !settingsModal.contains(ev.target) && ev.target !== desktopSettingsBtn) {
            settingsModal.classList.remove('active');
        }
    });

    // Escape key closes
    document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape' && settingsModal) {
            settingsModal.classList.remove('active');
        }
    });

    if (closeSettingsBtn) {
        closeSettingsBtn.addEventListener('click', () => {
            settingsModal.classList.remove('active');
        });
    }

    // Direct button click handler
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('Save Settings button clicked');
            saveSettings();
        });
    }

    if (settingsForm) {
        settingsForm.addEventListener('submit', (e) => {
            e.preventDefault();
            console.log('Settings form submitted');
            saveSettings();
        });
    }

    if (resetSettingsBtn) {
        resetSettingsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('Reset settings clicked');
            resetSettings();
        });
    }

    // Load saved settings on page load
    loadSettings();

    // Budget Modal Handlers
    const budgetModal = document.getElementById('budgetModal');
    const closeBudgetBtn = document.getElementById('closeBudgetBtn');
    const cancelBudgetBtn = document.getElementById('cancelBudgetBtn');
    const budgetForm = document.getElementById('budgetForm');
    const setBudgetBtn = document.getElementById('setBudgetBtn');

    if (setBudgetBtn) {
        setBudgetBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openBudgetModal(setBudgetBtn);
        });
    }

    if (closeBudgetBtn) {
        closeBudgetBtn.addEventListener('click', () => {
            budgetModal.classList.remove('active');
        });
    }

    if (cancelBudgetBtn) {
        cancelBudgetBtn.addEventListener('click', () => {
            budgetModal.classList.remove('active');
        });
    }

    if (budgetForm) {
        budgetForm.addEventListener('submit', (e) => {
            e.preventDefault();
            saveBudget();
        });
    }

    document.addEventListener('click', (ev) => {
        if (budgetModal && !budgetModal.contains(ev.target) && ev.target !== setBudgetBtn) {
            budgetModal.classList.remove('active');
        }
    });

    document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape' && budgetModal) {
            budgetModal.classList.remove('active');
        }
    });

    // Profile Modal Handlers
    const profileModal = document.getElementById('profileModal');
    const closeProfileBtn = document.getElementById('closeProfileBtn');
    const profileBtn = document.querySelector('button[title="Profile"]');

    if (profileBtn) {
        profileBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openProfileModal(profileBtn);
        });
    }

    if (closeProfileBtn) {
        closeProfileBtn.addEventListener('click', () => {
            profileModal.classList.remove('active');
        });
    }

    document.addEventListener('click', (ev) => {
        if (profileModal && !profileModal.contains(ev.target) && ev.target !== profileBtn) {
            profileModal.classList.remove('active');
        }
    });

    // Export Modal Handlers
    const exportModal = document.getElementById('exportModal');
    const closeExportBtn = document.getElementById('closeExportBtn');
    const exportBtn = document.querySelector('button[title="Export"]');
    const exportFormBtn = document.getElementById('exportBtn');

    if (exportBtn) {
        exportBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openExportModal(exportBtn);
        });
    }

    if (closeExportBtn) {
        closeExportBtn.addEventListener('click', () => {
            exportModal.classList.remove('active');
        });
    }

    if (exportFormBtn) {
        exportFormBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleExport();
        });
    }

    document.addEventListener('click', (ev) => {
        if (exportModal && !exportModal.contains(ev.target) && ev.target !== exportBtn) {
            exportModal.classList.remove('active');
        }
    });

    // About Modal Handlers
    const aboutModal = document.getElementById('aboutModal');
    const closeAboutBtn = document.getElementById('closeAboutBtn');
    const aboutBtn = document.querySelector('button[title="About"]');

    if (aboutBtn) {
        aboutBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openAboutModal(aboutBtn);
        });
    }

    if (closeAboutBtn) {
        closeAboutBtn.addEventListener('click', () => {
            aboutModal.classList.remove('active');
        });
    }

    document.addEventListener('click', (ev) => {
        if (aboutModal && !aboutModal.contains(ev.target) && ev.target !== aboutBtn) {
            aboutModal.classList.remove('active');
        }
    });

    // Mobile full-screen handlers (close buttons, forms)
    const closeMobileProfileBtn = document.getElementById('closeMobileProfileScreen');
    const closeMobileSettingsBtn = document.getElementById('closeMobileSettingsScreen');
    const mobileSettingsForm = document.getElementById('mobileSettingsForm');
    const mobileResetSettingsBtn = document.getElementById('mobileResetSettingsBtn');
    const closeMobileExportBtn = document.getElementById('closeMobileExportScreen');
    const mobileExportFormBtn = document.getElementById('mobileExportBtn2');
    const closeMobileAboutBtn = document.getElementById('closeMobileAboutScreen');

    if (closeMobileProfileBtn) closeMobileProfileBtn.addEventListener('click', closeMobileProfileScreen);
    if (closeMobileSettingsBtn) closeMobileSettingsBtn.addEventListener('click', closeMobileSettingsScreen);
    if (mobileSettingsForm) mobileSettingsForm.addEventListener('submit', (e) => { e.preventDefault(); saveMobileSettings(); });
    if (mobileResetSettingsBtn) mobileResetSettingsBtn.addEventListener('click', (e) => { e.preventDefault(); resetMobileSettings(); });
    if (closeMobileExportBtn) closeMobileExportBtn.addEventListener('click', closeMobileExportScreen);
    if (mobileExportFormBtn) mobileExportFormBtn.addEventListener('click', (e) => { e.preventDefault(); handleMobileExport(); });
    if (closeMobileAboutBtn) closeMobileAboutBtn.addEventListener('click', closeMobileAboutScreen);

    // Close screens on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeMobileProfileScreen();
            closeMobileSettingsScreen();
            closeMobileExportScreen();
            closeMobileAboutScreen();
        }
    });

    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
            addExpenseModal.classList.remove('active');
        });
    }

    if (cancelExpenseBtn) {
        cancelExpenseBtn.addEventListener('click', () => {
            addExpenseModal.classList.remove('active');
            document.getElementById('addExpenseForm').reset();
            document.getElementById('expenseDate').valueAsDate = new Date();
        });
    }

    // Close modal when clicking outside
    if (addExpenseModal) {
        addExpenseModal.addEventListener('click', (e) => {
            if (e.target === addExpenseModal) {
                addExpenseModal.classList.remove('active');
            }
        });
    }

    // Handle form submission
    if (addExpenseForm) {
        addExpenseForm.addEventListener('submit', (e) => {
            e.preventDefault();
            // Check which button was clicked
            const submitBtn = e.submitter;
            addExpenseFromModal(submitBtn ? submitBtn.id === 'addAnotherBtn' : false);
        });
    }

    // Initialize data displays
    renderTransactionsTable();
    updateBudgetOverview();
    updateSummaryTable();
    updateSevenDayChart();

    // Date picker setup
    const datePickerBtn = document.getElementById('datePickerBtn');
    const datePickerDropdown = document.getElementById('datePickerDropdown');
    const datePickerDisplay = document.getElementById('datePickerDisplay');
    
    function populateMonthDropdown(selected = null) {
        if (!datePickerDropdown) return;
        
        // Clear existing items
        datePickerDropdown.innerHTML = '';
        
        // Get saved budget date ranges from localStorage
        const budgetRanges = getAllBudgetDateRanges();
        
        if (budgetRanges.length > 0) {
            // Populate with saved date ranges
            budgetRanges.forEach((entry, idx) => {
                const div = document.createElement('div');
                div.className = 'date-range-item';
                div.textContent = entry.date_range;
                div.setAttribute('data-value', entry.date_range);
                div.setAttribute('data-budget', entry.budget);
                div.addEventListener('click', () => {
                    currentDateRange = entry.date_range;
                    datePickerDisplay.textContent = entry.date_range;
                    datePickerDropdown.classList.remove('active');
                    document.querySelectorAll('.date-range-item').forEach(el => el.classList.remove('active'));
                    div.classList.add('active');
                    // Update UI with selected range
                    updateBudgetOverview();
                    renderTransactionsTable();
                    updateSummaryTable();
                    updateSevenDayChart();
                });
                datePickerDropdown.appendChild(div);
            });
            
            // Add "All" option at the bottom
            const allDiv = document.createElement('div');
            allDiv.className = 'date-range-item';
            allDiv.textContent = 'All';
            allDiv.setAttribute('data-value', 'All');
            allDiv.addEventListener('click', () => {
                currentDateRange = null;
                datePickerDisplay.textContent = 'All';
                datePickerDropdown.classList.remove('active');
                document.querySelectorAll('.date-range-item').forEach(el => el.classList.remove('active'));
                allDiv.classList.add('active');
                // Update UI to show all data
                updateBudgetOverview();
                renderTransactionsTable();
                updateSummaryTable();
                updateSevenDayChart();
            });
            datePickerDropdown.appendChild(allDiv);
            
            // Set selected item or default to first
            if (selected) {
                const activeItem = datePickerDropdown.querySelector(`[data-value="${selected}"]`);
                if (activeItem) {
                    activeItem.classList.add('active');
                    datePickerDisplay.textContent = selected;
                    currentDateRange = selected === 'All' ? null : selected;
                }
            } else {
                // Default to first item
                const firstItem = datePickerDropdown.querySelector('.date-range-item');
                if (firstItem) {
                    firstItem.classList.add('active');
                    currentDateRange = budgetRanges[0].date_range;
                    datePickerDisplay.textContent = budgetRanges[0].date_range;
                }
            }
        } else {
            // No saved ranges, show "All" only
            const allDiv = document.createElement('div');
            allDiv.className = 'date-range-item active';
            allDiv.textContent = 'All';
            allDiv.setAttribute('data-value', 'All');
            allDiv.addEventListener('click', () => {
                currentDateRange = null;
                datePickerDisplay.textContent = 'All';
                datePickerDropdown.classList.remove('active');
            });
            datePickerDropdown.appendChild(allDiv);
            datePickerDisplay.textContent = 'All';
            currentDateRange = null;
        }
    }
    
    if (datePickerBtn && datePickerDropdown) {
        // Initial population
        populateMonthDropdown();
        
        // Toggle dropdown
        datePickerBtn.addEventListener('click', () => {
            datePickerDropdown.classList.toggle('active');
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!datePickerBtn.contains(e.target) && !datePickerDropdown.contains(e.target)) {
                datePickerDropdown.classList.remove('active');
            }
        });
        
        // Make populateMonthDropdown globally accessible for updates
        window.populateMonthDropdown = populateMonthDropdown;
    }

    // Context menu setup
    initContextMenu();
});

// Settings Modal Functions
function loadSettingsModal() {
    const settingsStr = localStorage.getItem('settings');
    if (settingsStr) {
        try {
            const settings = JSON.parse(settingsStr);
            if (settings.budget) document.getElementById('budgetInput').value = settings.budget;
            if (settings.currency) document.getElementById('currencySelect').value = settings.currency;
            if (settings.theme) document.getElementById('themeSelect').value = settings.theme;
            if (settings.notifications !== undefined) document.getElementById('notificationsCheckbox').checked = settings.notifications;
        } catch (e) {
            console.error('Error loading settings:', e);
        }
    }
}

function openSettingsModal(btnElement) {
    const settingsModal = document.getElementById('settingsModal');
    if (!settingsModal) return;
    
    // Load current settings into form
    loadSettingsModal();
    
    // Position modal to the left of button
    const modalContent = settingsModal.querySelector('.modal-content');
    if (btnElement && modalContent) {
        const btnRect = btnElement.getBoundingClientRect();
        let left = btnRect.left - 350 - 8;
        let top = btnRect.bottom + 8;
        
        if (left < 10) left = btnRect.right + 8;
        if (left + 350 > window.innerWidth - 10) left = window.innerWidth - 350 - 10;
        if (top + 400 > window.innerHeight - 10) top = btnRect.top - 400 - 8;
        if (top < 10) top = 10;
        
        modalContent.style.left = left + 'px';
        modalContent.style.top = top + 'px';
    }
    
    settingsModal.classList.add('active');
}

function saveSettings() {
    const budget = document.getElementById('budgetInput').value;
    const currency = document.getElementById('currencySelect').value;
    const theme = document.getElementById('themeSelect').value;
    const notifications = document.getElementById('notificationsCheckbox').checked;

    const settings = { budget, currency, theme, notifications };
    localStorage.setItem('settings', JSON.stringify(settings));
    
    showNotification('Settings saved successfully!');
    setTimeout(() => {
        window.location.reload();
    }, 500);
}

function openBudgetModal(btnElement) {
    const budgetModal = document.getElementById('budgetModal');
    if (!budgetModal) return;
    
    // Pre-fill with current date range if one is selected
    if (currentDateRange && currentDateRange !== 'All') {
        document.getElementById('budgetDateRange').value = currentDateRange;
        const currentBudget = getBudgetForDateRange(currentDateRange);
        if (currentBudget) {
            document.getElementById('budgetAmountInput').value = currentBudget;
        }
    } else {
        // Suggest current month range
        const today = new Date();
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = monthNames[today.getMonth()];
        const year = today.getFullYear();
        const daysInMonth = new Date(year, today.getMonth() + 1, 0).getDate();
        const rangeStr = `${month} 1 - ${month} ${daysInMonth}, ${year}`;
        document.getElementById('budgetDateRange').value = rangeStr;
    }
    
    // Position modal
    const modalContent = budgetModal.querySelector('.modal-content');
    if (btnElement && modalContent) {
        const btnRect = btnElement.getBoundingClientRect();
        let left = btnRect.left - 350 - 8;
        let top = btnRect.bottom + 8;
        
        if (left < 10) left = btnRect.right + 8;
        if (left + 350 > window.innerWidth - 10) left = window.innerWidth - 350 - 10;
        if (top + 400 > window.innerHeight - 10) top = btnRect.top - 400 - 8;
        if (top < 10) top = 10;
        
        modalContent.style.left = left + 'px';
        modalContent.style.top = top + 'px';
    }
    
    budgetModal.classList.add('active');
}

function saveBudget() {
    const dateRange = document.getElementById('budgetDateRange').value.trim();
    const budgetAmount = document.getElementById('budgetAmountInput').value;
    
    if (!dateRange || !budgetAmount) {
        alert('Please fill in all fields');
        return;
    }
    
    // Save budget for this date range
    saveBudgetForDateRange(dateRange, budgetAmount);
    
    // Close modal
    document.getElementById('budgetModal').classList.remove('active');
    
    // Refresh the dropdown
    if (window.populateMonthDropdown) {
        window.populateMonthDropdown(dateRange);
    }
    
    // Update UI
    currentDateRange = dateRange;
    document.getElementById('datePickerDisplay').textContent = dateRange;
    updateBudgetOverview();
    renderTransactionsTable();
    updateSummaryTable();
    updateSevenDayChart();
    
    showNotification('Budget saved successfully!');
}

function loadSettings() {
    loadSettingsModal();
}

function resetSettings() {
    localStorage.removeItem('settings');
    document.getElementById('settingsForm').reset();
    
    showNotification('Settings reset to default!');
    setTimeout(() => {
        window.location.reload();
    }, 500);
}

// Add Expense from Modal
function addExpenseFromModal(addAnother = false) {
    console.log('=== ADD EXPENSE CALLED ===');
    
    const expenseDescriptionEl = document.getElementById('expenseDescription');
    const expenseAmountEl = document.getElementById('expenseAmount');
    const expenseCategoryEl = document.getElementById('expenseCategory');
    const expenseDateEl = document.getElementById('expenseDate');
    const expenseNoteEl = document.getElementById('expenseNote');
    const formEl = document.getElementById('addExpenseForm');
    
    const description = expenseDescriptionEl ? expenseDescriptionEl.value.trim() : '';
    const amountInput = expenseAmountEl ? expenseAmountEl.value.trim() : '';
    const amount = parseFloat(amountInput);
    const category = expenseCategoryEl ? expenseCategoryEl.value.trim() : '';
    const date = expenseDateEl ? expenseDateEl.value : '';
    const note = expenseNoteEl ? expenseNoteEl.value.trim() : '';

    console.log('Form values:', { description, amountInput, amount, category, date, note });

    // Validate inputs
    if (!description) {
        alert('Please enter an expense name');
        return;
    }
    
    if (!amountInput || isNaN(amount) || amount <= 0) {
        alert('Please enter a valid amount greater than 0');
        return;
    }
    
    if (!category) {
        alert('Please select a category');
        return;
    }
    
    if (!date) {
        alert('Please select a date');
        return;
    }

    // Check if editing
    const editId = formEl.getAttribute('data-edit-id');
    
    if (editId) {
        // Update existing transaction
        const transaction = transactions.find(t => t.id == editId);
        if (transaction) {
            transaction.description = description;
            transaction.amount = -Math.abs(amount);
            transaction.category = category;
            transaction.date = date;
            transaction.note = note || '';
        }
        formEl.removeAttribute('data-edit-id');
        showNotification('Expense updated successfully!');
    } else {
        // Create new transaction
        const transaction = {
            id: Date.now(),
            description: description,
            amount: -Math.abs(amount),
            category: category,
            type: 'expense',
            date: date,
            note: note || '',
            createdAt: new Date().toISOString()
        };

        console.log('Creating transaction:', transaction);
        transactions.unshift(transaction);
        showNotification('Expense saved successfully!');
    }
    
    saveTransactions();
    
    console.log('All transactions:', transactions);
    
    // Update all displays
    renderTransactionsTable();
    updateBudgetOverview();
    updateSummaryTable();
    updateSevenDayChart();

    // Reset form
    if (expenseDescriptionEl) expenseDescriptionEl.value = '';
    if (expenseAmountEl) expenseAmountEl.value = '';
    if (expenseCategoryEl) expenseCategoryEl.value = 'Food';
    if (expenseNoteEl) expenseNoteEl.value = '';
    if (expenseDateEl) expenseDateEl.valueAsDate = new Date();
    
    const modal = document.getElementById('addExpenseModal');
    
    // If addAnother is true, keep modal open; otherwise close it
    if (!addAnother && modal) {
        modal.classList.remove('active');
    }
    
    // Focus on description field for next entry if addAnother
    if (addAnother && expenseDescriptionEl) {
        expenseDescriptionEl.focus();
    }
}

// Notification function
function showNotification(message) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        background: linear-gradient(135deg, #5EADE1 0%, #76C8E8 100%);
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(94, 173, 225, 0.3);
        z-index: 3000;
        animation: slideInRight 0.3s ease;
        font-weight: 600;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Save to localStorage
function saveTransactions() {
    localStorage.setItem('transactions', JSON.stringify(transactions));
    
    // Sync to Firebase if signed in and current date range is set
    if (currentUser && currentUser.uid && currentDateRange) {
        syncTransactionsToFirebase(currentDateRange, transactions);
    }
}

// Render Transactions Table
function renderTransactionsTable() {
    const tableBody = document.getElementById('transactionTableBody');
    console.log('renderTransactionsTable called, tableBody:', !!tableBody);
    
    if (!tableBody) {
        console.error('transactionTableBody element not found!');
        return;
    }
    
    const sorted = transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
    console.log('Sorted transactions count:', sorted.length);

    // Apply active filters if any
    const filtered = sorted.filter(t => {
        if (!activeFilters || Object.keys(activeFilters).length === 0) return true;
        const from = activeFilters.fromDate ? new Date(activeFilters.fromDate) : null;
        const to = activeFilters.toDate ? new Date(activeFilters.toDate) : null;
        const cat = activeFilters.category || '';
        const type = activeFilters.type || '';
        const minA = (typeof activeFilters.minAmount === 'number') ? activeFilters.minAmount : null;
        const maxA = (typeof activeFilters.maxAmount === 'number') ? activeFilters.maxAmount : null;

        const tDate = new Date(t.date);
        if (from && tDate < from) return false;
        if (to && tDate > to) return false;
        if (cat && cat !== '' && t.category !== cat) return false;
        if (type && type !== '' && t.type !== type) return false;
        const amt = Math.abs(Number(t.amount));
        if (minA !== null && amt < minA) return false;
        if (maxA !== null && amt > maxA) return false;
        return true;
    });

    if (filtered.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="5" class="empty-message">No transactions yet. Add one to get started!</td></tr>';
        return;
    }

    const html = filtered.map(transaction => {
        console.log('Rendering transaction:', transaction);
        return `
        <tr data-id="${transaction.id}">
            <td>${formatDate(transaction.date)}</td>
            <td>${transaction.description}</td>
            <td class="table-amount ${transaction.type}">${transaction.amount >= 0 ? '+' : ''}${formatCurrency(transaction.amount)}</td>
            <td>${getCategoryEmoji(transaction.category)} ${transaction.category}</td>
            <td>${transaction.note || '-'}</td>
        </tr>
    `;
    }).join('');
    
    tableBody.innerHTML = html;
    console.log('Table HTML updated');
}

// Update Budget Overview
function updateBudgetOverview() {
    // Get budget for current date range
    let budgetAmount = 0;
    if (currentDateRange && currentDateRange !== 'All') {
        budgetAmount = getBudgetForDateRange(currentDateRange);
    } else {
        // If "All" is selected, sum all budgets or use global setting
        const settingsStr = localStorage.getItem('settings');
        if (settingsStr) {
            try {
                const settings = JSON.parse(settingsStr);
                budgetAmount = parseFloat(settings.budget) || 0;
            } catch (e) {
                budgetAmount = 0;
            }
        }
    }
    
    const totalIncome = transactions
        .filter(t => t.type === 'income')
        .reduce((sum, t) => sum + t.amount, 0);

    const totalExpense = Math.abs(transactions
        .filter(t => t.type === 'expense')
        .reduce((sum, t) => sum + t.amount, 0));

    // Use budget if available, otherwise use income
    const baseAmount = budgetAmount > 0 ? budgetAmount : totalIncome;
    const remaining = baseAmount - totalExpense;
    const remainingPercent = baseAmount > 0 ? (remaining / baseAmount) * 100 : 0;

    // Update elements
    const progressBarEl = document.getElementById('progressBar');
    const progressBarPercentEl = document.getElementById('progressBarPercent');
    const remainingBelowEl = document.getElementById('remainingBelow');
    const spendBelowEl = document.getElementById('spendBelow');

    const clampedRemaining = Math.max(0, Math.min(remainingPercent, 100));

    if (progressBarEl) progressBarEl.style.width = clampedRemaining + '%';
    if (progressBarPercentEl) progressBarPercentEl.textContent = Math.round(clampedRemaining) + '%';
    if (remainingBelowEl) remainingBelowEl.textContent = formatCurrency(Math.max(remaining, 0));
    if (spendBelowEl) spendBelowEl.textContent = formatCurrency(totalExpense);
}

// Update Summary Table
function updateSummaryTable() {
    const summaryBody = document.getElementById('summaryTableBody');
    if (!summaryBody) return;
    
    const categoryStats = {};
    
    transactions
        .filter(t => t.type === 'expense')
        .forEach(t => {
            if (!categoryStats[t.category]) {
                categoryStats[t.category] = { total: 0, count: 0 };
            }
            categoryStats[t.category].total += Math.abs(t.amount);
            categoryStats[t.category].count += 1;
        });

    if (Object.keys(categoryStats).length === 0) {
        summaryBody.innerHTML = '<tr><td colspan="5" class="empty-message">No expenses yet</td></tr>';
        return;
    }

    const sorted = Object.entries(categoryStats)
        .sort((a, b) => b[1].total - a[1].total);

    summaryBody.innerHTML = sorted.map(([category, stats], index) => {
        const average = (stats.total / stats.count).toFixed(2);
        return `
        <tr>
            <td>${index + 1}</td>
            <td>${getCategoryEmoji(category)} ${category}</td>
            <td style="text-align: right; font-weight: 600; color: #f56565;">${formatCurrency(stats.total)}</td>
            <td style="text-align: right; font-weight: 600; color: #f56565;">${formatCurrency(average)}</td>
            <td style="text-align: center;">${stats.count}</td>
        </tr>
    `;
    }).join('');
}

// Update Chart (Category-Based Aggregation - Matches Desktop)
function updateSevenDayChart() {
    const ctx = document.getElementById('sevenDayChart');
    if (!ctx) return;

    // Build master categories from transactions (date labels in "Mon D" format)
    const categoryMap = new Map();
    const expenseTransactions = transactions.filter(t => t.type === 'expense');
    
    // Collect unique date labels and aggregate amounts
    expenseTransactions.forEach(t => {
        const d = new Date(t.date);
        const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const amount = Math.abs(t.amount);
        categoryMap.set(label, (categoryMap.get(label) || 0) + amount);
    });

    // Sort by date (parse back to compare chronologically)
    const sortedEntries = Array.from(categoryMap.entries()).sort((a, b) => {
        const parseLabel = (lbl) => {
            const parts = lbl.split(' ');
            const month = new Date(Date.parse(parts[0] + ' 1, 2000')).getMonth();
            const day = parseInt(parts[1], 10);
            return new Date(new Date().getFullYear(), month, day);
        };
        return parseLabel(a[0]) - parseLabel(b[0]);
    });

    // Store all data globally
    chartAllLabels = sortedEntries.map(e => e[0]);
    chartAllData = sortedEntries.map(e => e[1]);
    chartTotalBars = chartAllLabels.length;

    // Apply 7-bar window
    const maxStart = Math.max(0, chartTotalBars - chartVisibleCount);
    chartStartIndex = Math.min(chartStartIndex, maxStart);
    const endIndex = Math.min(chartStartIndex + chartVisibleCount, chartTotalBars);
    
    const labels = chartAllLabels.slice(chartStartIndex, endIndex);
    const data = chartAllData.slice(chartStartIndex, endIndex);

    // Auto-scale Y-axis: find max value and add 10% headroom
    const maxVal = chartAllData.length > 0 ? Math.max(...chartAllData) : 100;
    const yMax = Math.ceil(maxVal * 1.1);

    if (sevenDayChart) {
        // Update existing chart data smoothly instead of destroying
        sevenDayChart.data.labels = labels;
        sevenDayChart.data.datasets[0].data = data;
        sevenDayChart.options.scales.y.max = yMax;
        sevenDayChart.update('active'); // Smooth transition animation
        return;
    }

    sevenDayChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Daily Spending',
                data: data,
                backgroundColor: '#5EADE1',
                borderColor: '#4A97C8',
                borderWidth: 0,
                borderRadius: 6,
                hoverBackgroundColor: '#76C8E8',
                barThickness: 40,
                maxBarThickness: 50
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            indexAxis: 'x',
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    padding: 12,
                    cornerRadius: 6,
                    titleFont: { size: 13, weight: '600' },
                    bodyFont: { size: 12 },
                    callbacks: {
                        label: function(context) {
                            return 'Spend: ' + formatCurrency(context.parsed.y);
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: yMax,
                    ticks: {
                        callback: function(value) {
                            const symbol = currencySymbols[currentCurrency] || '$';
                            return symbol + value.toFixed(0);
                        },
                        font: { size: 10, family: 'Arial' },
                        color: '#171c1f'
                    },
                    grid: {
                        color: '#e6e6e6',
                        lineWidth: 1,
                        drawBorder: true
                    }
                },
                x: {
                    ticks: {
                        font: { size: 11, family: 'Arial' },
                        color: '#171c1f'
                    },
                    grid: {
                        display: false
                    }
                }
            },
            animation: {
                duration: 300,
                easing: 'easeOutQuart'
            },
            transitions: {
                active: {
                    animation: {
                        duration: 300,
                        easing: 'easeOutQuart'
                    }
                }
            }
        }
    });
    
    // Enable drag scrolling
    enableChartDragScroll();
}

// Enable horizontal drag scrolling on chart with immediate feedback (matches desktop)
function enableChartDragScroll() {
    const container = document.querySelector('.chart-container');
    if (!container) return;
    
    let isDragging = false;
    let lastX = 0;
    let accumulatedDelta = 0;
    
    // Mouse events
    container.addEventListener('mousedown', (e) => {
        isDragging = true;
        lastX = e.clientX;
        accumulatedDelta = 0;
        container.style.cursor = 'grabbing';
        e.preventDefault();
    });
    
    container.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        const dx = e.clientX - lastX;
        accumulatedDelta += dx;
        
        // Calculate pixels per bar based on canvas width
        const canvas = document.getElementById('sevenDayChart');
        const canvasWidth = canvas ? canvas.offsetWidth : 400;
        const pixelsPerBar = canvasWidth / chartVisibleCount;
        
        // Immediate index shift based on accumulated delta
        const deltaIndex = -Math.round(accumulatedDelta / pixelsPerBar);
        
        if (deltaIndex !== 0) {
            const maxStart = Math.max(0, chartTotalBars - chartVisibleCount);
            const newIndex = Math.max(0, Math.min(maxStart, chartStartIndex + deltaIndex));
            
            if (newIndex !== chartStartIndex) {
                chartStartIndex = newIndex;
                updateSevenDayChart();
                // Reset accumulated delta after applying shift
                accumulatedDelta = 0;
            }
        }
        
        lastX = e.clientX;
        e.preventDefault();
    });
    
    const stopDragging = () => {
        if (!isDragging) return;
        isDragging = false;
        accumulatedDelta = 0;
        container.style.cursor = 'grab';
    };
    
    container.addEventListener('mouseup', stopDragging);
    container.addEventListener('mouseleave', stopDragging);
    
    // Touch events for mobile
    container.addEventListener('touchstart', (e) => {
        isDragging = true;
        lastX = e.touches[0].clientX;
        accumulatedDelta = 0;
    }, { passive: true });
    
    container.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        
        const dx = e.touches[0].clientX - lastX;
        accumulatedDelta += dx;
        
        // Calculate pixels per bar based on canvas width
        const canvas = document.getElementById('sevenDayChart');
        const canvasWidth = canvas ? canvas.offsetWidth : 400;
        const pixelsPerBar = canvasWidth / chartVisibleCount;
        
        // Immediate index shift based on accumulated delta
        const deltaIndex = -Math.round(accumulatedDelta / pixelsPerBar);
        
        if (deltaIndex !== 0) {
            const maxStart = Math.max(0, chartTotalBars - chartVisibleCount);
            const newIndex = Math.max(0, Math.min(maxStart, chartStartIndex + deltaIndex));
            
            if (newIndex !== chartStartIndex) {
                chartStartIndex = newIndex;
                updateSevenDayChart();
                // Reset accumulated delta after applying shift
                accumulatedDelta = 0;
            }
        }
        
        lastX = e.touches[0].clientX;
        
        // Prevent page scroll while dragging chart
        if (Math.abs(accumulatedDelta) > 10) {
            e.preventDefault();
        }
    }, { passive: false });
    
    const stopTouchDragging = () => {
        if (!isDragging) return;
        isDragging = false;
        accumulatedDelta = 0;
    };
    
    container.addEventListener('touchend', stopTouchDragging);
    container.addEventListener('touchcancel', stopTouchDragging);
}

// Scroll chart window left (for programmatic use)
function scrollChartLeft() {
    if (chartStartIndex > 0) {
        chartStartIndex = Math.max(0, chartStartIndex - 1);
        updateSevenDayChart();
    }
}

// Scroll chart window right (for programmatic use)
function scrollChartRight() {
    const maxStart = Math.max(0, chartTotalBars - chartVisibleCount);
    if (chartStartIndex < maxStart) {
        chartStartIndex = Math.min(maxStart, chartStartIndex + 1);
        updateSevenDayChart();
    }
}

// Update scroll button visibility/state (no longer needed but kept for compatibility)
function updateChartScrollButtons() {
    // No-op: buttons removed, drag scrolling enabled
}

// Format Date
function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Get Category Emoji
function getCategoryEmoji(category) {
    const emojis = {
        'Food': '🍔',
        'Transportation': '🚗',
        'Entertainment': '🎬',
        'Utilities': '💡',
        'Healthcare': '🏥',
        'Shopping': '🛍️',
        'Salary': '💰',
        'Other': '📌'
    };
    return emojis[category] || '📌';
}

// Add animation styles
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOutRight {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// Undo history and context menu
let deletedTransactions = [];
let selectedTransactionId = null;

function initContextMenu() {
    const contextMenu = document.getElementById('contextMenu');
    const tableBody = document.getElementById('transactionTableBody');
    
    // Hide context menu on click outside
    document.addEventListener('click', () => {
        contextMenu.classList.remove('active');
    });

    // Right-click on table rows
    if (tableBody) {
        tableBody.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            
            // Get the clicked row
            const row = e.target.closest('tr');
            if (!row) return;
            
            // Get transaction ID from data attribute
            const transactionId = row.getAttribute('data-id');
            if (!transactionId) return;
            
            selectedTransactionId = transactionId;
            
            // Position context menu
            contextMenu.style.left = e.pageX + 'px';
            contextMenu.style.top = e.pageY + 'px';
            contextMenu.classList.add('active');
        });
    }

    // Context menu item actions
    document.getElementById('editOption').addEventListener('click', () => {
        editTransaction(selectedTransactionId);
        document.getElementById('contextMenu').classList.remove('active');
    });

    document.getElementById('deleteOption').addEventListener('click', () => {
        deleteTransaction(selectedTransactionId);
        document.getElementById('contextMenu').classList.remove('active');
    });

    document.getElementById('undoOption').addEventListener('click', () => {
        undoDelete();
        document.getElementById('contextMenu').classList.remove('active');
    });
}

function editTransaction(transactionId) {
    const transaction = transactions.find(t => t.id == transactionId);
    if (!transaction) return;
    
    const row = document.querySelector(`tr[data-id="${transactionId}"]`);
    if (!row) return;
    
    // Store original values in case of cancel
    const originalHTML = row.innerHTML;
    
    // Create inline edit HTML
    row.classList.add('edit-mode');
    row.innerHTML = `
        <td><input type="date" class="edit-date" value="${transaction.date}" /></td>
        <td><input type="text" class="edit-description" value="${transaction.description}" /></td>
        <td><input type="number" class="edit-amount" step="0.01" min="0" value="${Math.abs(transaction.amount)}" /></td>
        <td>
            <select class="edit-category">
                <option value="Food" ${transaction.category === 'Food' ? 'selected' : ''}>Food</option>
                <option value="Transportation" ${transaction.category === 'Transportation' ? 'selected' : ''}>Transportation</option>
                <option value="Entertainment" ${transaction.category === 'Entertainment' ? 'selected' : ''}>Entertainment</option>
                <option value="Utilities" ${transaction.category === 'Utilities' ? 'selected' : ''}>Utilities</option>
                <option value="Healthcare" ${transaction.category === 'Healthcare' ? 'selected' : ''}>Healthcare</option>
                <option value="Shopping" ${transaction.category === 'Shopping' ? 'selected' : ''}>Shopping</option>
                <option value="Other" ${transaction.category === 'Other' ? 'selected' : ''}>Other</option>
            </select>
        </td>
        <td>
            <div class="edit-row-actions">
                <button class="edit-row-btn save" onclick="saveInlineEdit('${transactionId}')">Save</button>
                <button class="edit-row-btn cancel" onclick="cancelInlineEdit('${transactionId}')">Cancel</button>
            </div>
        </td>
    `;
    
    // Focus on first input
    row.querySelector('.edit-date').focus();
    
    // Store original HTML for cancel
    row.setAttribute('data-original-html', originalHTML);
}

function saveInlineEdit(transactionId) {
    const transaction = transactions.find(t => t.id == transactionId);
    const row = document.querySelector(`tr[data-id="${transactionId}"]`);
    
    if (!transaction || !row) return;
    
    // Get edited values
    const date = row.querySelector('.edit-date').value;
    const description = row.querySelector('.edit-description').value.trim();
    const amount = parseFloat(row.querySelector('.edit-amount').value);
    const category = row.querySelector('.edit-category').value;
    
    // Validate
    if (!description) {
        alert('Please enter an expense name');
        return;
    }
    
    if (!amount || amount <= 0) {
        alert('Please enter a valid amount greater than 0');
        return;
    }
    
    if (!date) {
        alert('Please select a date');
        return;
    }
    
    // Update transaction
    transaction.description = description;
    transaction.amount = -Math.abs(amount);
    transaction.category = category;
    transaction.date = date;
    
    saveTransactions();
    row.classList.remove('edit-mode');
    renderTransactionsTable();
    updateBudgetOverview();
    updateSummaryTable();
    updateSevenDayChart();
    
    showNotification('Expense updated successfully!');
}

function cancelInlineEdit(transactionId) {
    const row = document.querySelector(`tr[data-id="${transactionId}"]`);
    if (!row) return;
    
    const originalHTML = row.getAttribute('data-original-html');
    row.classList.remove('edit-mode');
    row.innerHTML = originalHTML;
    row.removeAttribute('data-original-html');
}

function deleteTransaction(transactionId) {
    const transaction = transactions.find(t => t.id == transactionId);
    if (!transaction) return;
    
    // Save to undo history
    deletedTransactions.push(transaction);
    
    // Remove from transactions
    transactions = transactions.filter(t => t.id != transactionId);
    saveTransactions();
    
    // Update displays
    renderTransactionsTable();
    updateBudgetOverview();
    updateSummaryTable();
    updateSevenDayChart();
    
    showNotification('Expense deleted. Undo available for 30 seconds.');
    
    // Clear undo after 30 seconds
    setTimeout(() => {
        deletedTransactions = [];
    }, 30000);
}

function undoDelete() {
    if (deletedTransactions.length === 0) {
        showNotification('Nothing to undo');
        return;
    }
    
    const lastDeleted = deletedTransactions.pop();
    transactions.unshift(lastDeleted);
    saveTransactions();
    
    // Update displays
    renderTransactionsTable();
    updateBudgetOverview();
    updateSummaryTable();
    updateSevenDayChart();
    
    showNotification('Expense restored!');
}

// Calendar Picker for Budget Date Range
let selectedStartDate = null;
let selectedEndDate = null;
let currentCalendarMonth = new Date();
let isSelectingStartDate = true;

function initCalendarPicker() {
    const dateRangeDisplay = document.getElementById('dateRangeDisplay');
    const dateRangeCalendar = document.getElementById('dateRangeCalendar');
    const resetDatesBtn = document.getElementById('resetDatesBtn');
    const confirmDatesBtn = document.getElementById('confirmDatesBtn');
    
    if (!dateRangeDisplay || !dateRangeCalendar) return;

    // Helper: position the calendar to the left side of the screen, outside the budget modal
    function positionCalendar() {
        const rect = dateRangeDisplay.getBoundingClientRect();
        // Position calendar to the left side of the date picker
        // Try to align the right edge of calendar with left edge of display
        let left = rect.left - 400 - 16; // 400px calendar width + 16px gap
        
        // If not enough space on left, position it to the right of the display
        if (left < 16) {
            left = rect.right + 16;
        }
        
        // Vertically center near the display
        let top = rect.top - 100; // Adjust vertically to center roughly with display
        
        // Ensure calendar stays within viewport
        if (top < 16) top = 16;
        if (top + 550 > window.innerHeight) { // 550px is rough calendar height
            top = window.innerHeight - 550 - 16;
        }
        
        // Apply fixed positioning
        dateRangeCalendar.style.position = 'fixed';
        dateRangeCalendar.style.left = `${left}px`;
        dateRangeCalendar.style.top = `${top}px`;
        dateRangeCalendar.style.right = 'auto';
        dateRangeCalendar.style.zIndex = '3002';
    }

    // Toggle calendar visibility
    dateRangeDisplay.addEventListener('click', (e) => {
        e.stopPropagation();
        dateRangeCalendar.classList.toggle('active');
        if (dateRangeCalendar.classList.contains('active')) {
            isSelectingStartDate = !selectedStartDate || selectedEndDate ? true : false;
            renderCalendar();
            positionCalendar();
            // reposition on window scroll/resize
            window.addEventListener('resize', positionCalendar);
            window.addEventListener('scroll', positionCalendar, true);
        } else {
            window.removeEventListener('resize', positionCalendar);
            window.removeEventListener('scroll', positionCalendar, true);
        }
    });
    
    // Close calendar when clicking outside
    document.addEventListener('click', (e) => {
        if (!dateRangeDisplay.contains(e.target) && !dateRangeCalendar.contains(e.target)) {
            dateRangeCalendar.classList.remove('active');
            window.removeEventListener('resize', positionCalendar);
            window.removeEventListener('scroll', positionCalendar, true);
        }
    });
    
    // Month navigation
    const prev = document.getElementById('prevMonth');
    const next = document.getElementById('nextMonth');
    if (prev) {
        prev.addEventListener('click', (e) => {
            e.preventDefault();
            currentCalendarMonth = new Date(currentCalendarMonth.getFullYear(), currentCalendarMonth.getMonth() - 1, 1);
            renderCalendar();
            positionCalendar();
        });
    }
    if (next) {
        next.addEventListener('click', (e) => {
            e.preventDefault();
            currentCalendarMonth = new Date(currentCalendarMonth.getFullYear(), currentCalendarMonth.getMonth() + 1, 1);
            renderCalendar();
            positionCalendar();
        });
    }
    
    // Reset button
    if (resetDatesBtn) {
        resetDatesBtn.addEventListener('click', (e) => {
            e.preventDefault();
            selectedStartDate = null;
            selectedEndDate = null;
            isSelectingStartDate = true;
            currentCalendarMonth = new Date();
            updateDateRangeDisplay();
            renderCalendar();
            positionCalendar();
        });
    }
    
    // Confirm button
    if (confirmDatesBtn) {
        confirmDatesBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (selectedStartDate && selectedEndDate) {
                dateRangeCalendar.classList.remove('active');
                window.removeEventListener('resize', positionCalendar);
                window.removeEventListener('scroll', positionCalendar, true);
            }
        });
    }
    
    // Initial render
    renderCalendar();
}

function renderCalendar() {
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    
    const daysContainer = document.getElementById('calendarDays');
    const monthDisplay = document.getElementById('monthDisplay');
    const calendarStatus = document.getElementById('calendarStatus');
    
    if (!daysContainer || !monthDisplay || !calendarStatus) return;
    
    monthDisplay.textContent = `${monthNames[currentCalendarMonth.getMonth()]} ${currentCalendarMonth.getFullYear()}`;
    
    // Update status indicator
    if (isSelectingStartDate) {
        calendarStatus.textContent = 'Start Date';
    } else {
        calendarStatus.textContent = 'End Date';
    }
    
    daysContainer.innerHTML = '';
    
    const firstDay = new Date(currentCalendarMonth.getFullYear(), currentCalendarMonth.getMonth(), 1).getDay();
    const daysInMonth = new Date(currentCalendarMonth.getFullYear(), currentCalendarMonth.getMonth() + 1, 0).getDate();
    
    // Empty cells for days before month starts
    for (let i = 0; i < firstDay; i++) {
        const empty = document.createElement('div');
        empty.className = 'calendar-day empty';
        daysContainer.appendChild(empty);
    }
    
    // Days of the month
    for (let day = 1; day <= daysInMonth; day++) {
        const dayEl = document.createElement('div');
        dayEl.className = 'calendar-day';
        dayEl.textContent = day;
        
        const currentDate = new Date(currentCalendarMonth.getFullYear(), currentCalendarMonth.getMonth(), day);
        
        // Check if selected
        if (selectedStartDate && currentDate.toDateString() === selectedStartDate.toDateString()) {
            dayEl.classList.add('selected');
        }
        if (selectedEndDate && currentDate.toDateString() === selectedEndDate.toDateString()) {
            dayEl.classList.add('selected');
        }
        
        // Check if in range
        if (selectedStartDate && selectedEndDate && 
            currentDate > selectedStartDate && currentDate < selectedEndDate) {
            dayEl.classList.add('in-range');
        }
        
        // Click handler
        dayEl.addEventListener('click', () => {
            selectDate(currentDate);
        });
        
        daysContainer.appendChild(dayEl);
    }
}

function selectDate(date) {
    if (isSelectingStartDate) {
        selectedStartDate = date;
        isSelectingStartDate = false;
    } else {
        selectedEndDate = date;
        // If end date is before start date, swap them
        if (selectedEndDate < selectedStartDate) {
            const temp = selectedStartDate;
            selectedStartDate = selectedEndDate;
            selectedEndDate = temp;
        }
    }
    
    updateDateRangeDisplay();
    renderCalendar();
}

function updateDateRangeDisplay() {
    if (selectedStartDate && selectedEndDate) {
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const start = `${monthNames[selectedStartDate.getMonth()]} ${selectedStartDate.getDate()}`;
        const end = `${monthNames[selectedEndDate.getMonth()]} ${selectedEndDate.getDate()}`;
        const year = selectedEndDate.getFullYear();
        document.getElementById('budgetDateRangeDisplay').textContent = `${start} - ${end}, ${year}`;
    }
}

// Settings Functions
function openSettingsModal(btnElement) {
    const settingsModal = document.getElementById('settingsModal');
    if (!settingsModal) return;
    
    settingsModal.classList.add('active');
    
    // Position settings modal below and to the left of settings button
    const modalContent = settingsModal.querySelector('.modal-content');
    if (btnElement && modalContent) {
        const btnRect = btnElement.getBoundingClientRect();
        let left = btnRect.left - 320 - 8; // 320px modal width + 8px gap
        let top = btnRect.bottom + 8; // Below button with 8px gap
        
        // If not enough space on left, position on right
        if (left < 10) {
            left = btnRect.right + 8;
        }
        
        // Adjust if goes off-screen right
        if (left + 320 > window.innerWidth - 10) {
            left = window.innerWidth - 320 - 10;
        }
        
        // Adjust if goes off-screen bottom
        if (top + 600 > window.innerHeight - 10) {
            top = btnRect.top - 600 - 8; // Position above if not enough space below
        }
        
        // Adjust if goes off-screen top
        if (top < 10) {
            top = 10;
        }
        
        modalContent.style.left = left + 'px';
        modalContent.style.top = top + 'px';
    }
}

function saveSettings() {
    const budget = document.getElementById('budgetInput').value;
    const currency = document.getElementById('currencySelect').value;
    const theme = document.getElementById('themeSelect').value;
    const notifications = document.getElementById('notificationsCheckbox').checked;

    const settings = { budget, currency, theme, notifications };
    localStorage.setItem('settings', JSON.stringify(settings));
    showNotification('Settings saved successfully!');

    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal) {
        settingsModal.classList.remove('active');
    }
}

function loadSettings() {
    const settingsStr = localStorage.getItem('settings');
    if (settingsStr) {
        const settings = JSON.parse(settingsStr);
        if (settings.budget) document.getElementById('budgetInput').value = settings.budget;
        if (settings.currency) document.getElementById('currencySelect').value = settings.currency;
        if (settings.theme) document.getElementById('themeSelect').value = settings.theme;
        if (settings.notifications !== undefined) document.getElementById('notificationsCheckbox').checked = settings.notifications;
    }
}

function resetSettings() {
    localStorage.removeItem('settings');
    document.getElementById('settingsForm').reset();
    loadSettings();
    showNotification('Settings reset to default!');
}

// Profile Modal Functions
function openProfileModal(btnElement) {
    const profileModal = document.getElementById('profileModal');
    if (!profileModal) return;
    
    profileModal.classList.add('active');
    
    // Update profile info
    const totalTransactions = transactions.length;
    const userElement = document.getElementById('totalTransactions');
    if (userElement) userElement.textContent = totalTransactions;
    
    // Position modal
    const modalContent = profileModal.querySelector('.modal-content');
    if (btnElement && modalContent) {
        const btnRect = btnElement.getBoundingClientRect();
        let left = btnRect.left - 320 - 8;
        let top = btnRect.bottom + 8;
        
        if (left < 10) left = btnRect.right + 8;
        if (left + 320 > window.innerWidth - 10) left = window.innerWidth - 320 - 10;
        if (top + 400 > window.innerHeight - 10) top = btnRect.top - 400 - 8;
        if (top < 10) top = 10;
        
        modalContent.style.left = left + 'px';
        modalContent.style.top = top + 'px';
    }
}

// Export Modal Functions
function openExportModal(btnElement) {
    const exportModal = document.getElementById('exportModal');
    if (!exportModal) return;
    
    exportModal.classList.add('active');
    
    const modalContent = exportModal.querySelector('.modal-content');
    if (btnElement && modalContent) {
        const btnRect = btnElement.getBoundingClientRect();
        let left = btnRect.left - 320 - 8;
        let top = btnRect.bottom + 8;
        
        if (left < 10) left = btnRect.right + 8;
        if (left + 320 > window.innerWidth - 10) left = window.innerWidth - 320 - 10;
        if (top + 400 > window.innerHeight - 10) top = btnRect.top - 400 - 8;
        if (top < 10) top = 10;
        
        modalContent.style.left = left + 'px';
        modalContent.style.top = top + 'px';
    }
}

function handleExport() {
    const format = document.querySelector('input[name="exportFormat"]:checked').value;
    const fromDate = document.getElementById('exportFromDate').value;
    const toDate = document.getElementById('exportToDate').value;
    
    if (format === 'csv') {
        exportToCSV(fromDate, toDate);
    } else if (format === 'json') {
        exportToJSON(fromDate, toDate);
    } else if (format === 'excel') {
        showNotification('Excel export coming soon!');
    }
    
    document.getElementById('exportModal').classList.remove('active');
}

function exportToCSV(fromDate, toDate) {
    // Filter transactions by date range
    let filtered = transactions;
    if (fromDate || toDate) {
        const from = fromDate ? new Date(fromDate) : null;
        const to = toDate ? new Date(toDate) : null;
        
        filtered = transactions.filter(t => {
            const tDate = new Date(t.date);
            if (from && tDate < from) return false;
            if (to && tDate > to) return false;
            return true;
        });
    }
    
    const headers = ['Date', 'Description', 'Amount', 'Category', 'Type', 'Note'];
    const rows = filtered.map(t => [
        t.date,
        t.description,
        t.amount,
        t.category,
        t.type,
        t.note || ''
    ]);
    
    let csv = headers.join(',') + '\n';
    rows.forEach(row => {
        csv += row.map(cell => `"${cell}"`).join(',') + '\n';
    });
    
    const blob = new Blob([csv], { type: 'text/csv' });
    downloadFile(blob, 'expenses.csv');
    showNotification(`Data exported to CSV successfully! (${rows.length} records)`);
}

function exportToJSON(fromDate, toDate) {
    // Filter transactions by date range
    let filtered = transactions;
    if (fromDate || toDate) {
        const from = fromDate ? new Date(fromDate) : null;
        const to = toDate ? new Date(toDate) : null;
        
        filtered = transactions.filter(t => {
            const tDate = new Date(t.date);
            if (from && tDate < from) return false;
            if (to && tDate > to) return false;
            return true;
        });
    }
    
    const data = {
        exportDate: new Date().toISOString(),
        dateRange: {
            from: fromDate || 'All',
            to: toDate || 'All'
        },
        recordCount: filtered.length,
        transactions: filtered
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadFile(blob, 'expenses.json');
    showNotification(`Data exported to JSON successfully! (${filtered.length} records)`);
}

function downloadFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// About Modal Functions
function openAboutModal(btnElement) {
    const aboutModal = document.getElementById('aboutModal');
    if (!aboutModal) return;
    
    aboutModal.classList.add('active');
    
    const modalContent = aboutModal.querySelector('.modal-content');
    if (btnElement && modalContent) {
        const btnRect = btnElement.getBoundingClientRect();
        let left = btnRect.left - 320 - 8;
        let top = btnRect.bottom + 8;
        
        if (left < 10) left = btnRect.right + 8;
        if (left + 320 > window.innerWidth - 10) left = window.innerWidth - 320 - 10;
        if (top + 500 > window.innerHeight - 10) top = btnRect.top - 500 - 8;
        if (top < 10) top = 10;
        
        modalContent.style.left = left + 'px';
        modalContent.style.top = top + 'px';
    }
}

// Mobile Full-Screen Modals
function openMobileProfileScreen() {
    const screen = document.getElementById('mobileProfileScreen');
    if (!screen) return;
    
    // Update profile info
    const totalTransactions = transactions.length;
    document.getElementById('totalTransactionsMobile').textContent = totalTransactions;
    
    screen.classList.add('active');
    screen.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
}

function closeMobileProfileScreen() {
    const screen = document.getElementById('mobileProfileScreen');
    if (!screen) return;
    screen.classList.remove('active');
    screen.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
}

function openMobileSettingsScreen() {
    const screen = document.getElementById('mobileSettingsScreen');
    if (!screen) return;
    
    // Load settings into form
    const settingsStr = localStorage.getItem('settings');
    if (settingsStr) {
        const settings = JSON.parse(settingsStr);
        if (settings.budget) document.getElementById('mobilebudgetInput').value = settings.budget;
        if (settings.currency) document.getElementById('mobilecurrencySelect').value = settings.currency;
        if (settings.theme) document.getElementById('mobilethemeSelect').value = settings.theme;
        if (settings.notifications !== undefined) document.getElementById('mobilenotificationsCheckbox').checked = settings.notifications;
    }
    
    screen.classList.add('active');
    screen.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
}

function closeMobileSettingsScreen() {
    const screen = document.getElementById('mobileSettingsScreen');
    if (!screen) return;
    screen.classList.remove('active');
    screen.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
}

function saveMobileSettings() {
    const budget = document.getElementById('mobilebudgetInput').value;
    const currency = document.getElementById('mobilecurrencySelect').value;
    const theme = document.getElementById('mobilethemeSelect').value;
    const notifications = document.getElementById('mobilenotificationsCheckbox').checked;

    const settings = { budget, currency, theme, notifications };
    localStorage.setItem('settings', JSON.stringify(settings));
    
    showNotification('Settings saved successfully!');
    setTimeout(() => {
        window.location.reload();
    }, 500);
}

function resetMobileSettings() {
    localStorage.removeItem('settings');
    document.getElementById('mobileSettingsForm').reset();
    
    showNotification('Settings reset to default!');
    setTimeout(() => {
        window.location.reload();
    }, 500);
}

function openMobileExportScreen() {
    const screen = document.getElementById('mobileExportScreen');
    if (!screen) return;
    
    screen.classList.add('active');
    screen.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
}

function closeMobileExportScreen() {
    const screen = document.getElementById('mobileExportScreen');
    if (!screen) return;
    screen.classList.remove('active');
    screen.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
}

function handleMobileExport() {
    const format = document.querySelector('input[name="mobileExportFormat"]:checked').value;
    const fromDate = document.getElementById('mobileExportFromDate').value;
    const toDate = document.getElementById('mobileExportToDate').value;
    
    if (format === 'csv') {
        exportToCSV(fromDate, toDate);
    } else if (format === 'json') {
        exportToJSON(fromDate, toDate);
    } else if (format === 'pdf') {
        exportToPDF(fromDate, toDate);
    }
    
    closeMobileExportScreen();
}

// User profile and authentication functions
function displayUserInfo() {
    const userNameDisplay = document.getElementById('userNameDisplay');
    if (currentUser && currentUser.name && userNameDisplay) {
        const firstName = currentUser.name.split(' ')[0];
        userNameDisplay.textContent = firstName;
    }
    
    // Load data from Firebase after displaying user info
    if (currentUser && currentUser.uid) {
        loadDataFromFirebase();
    }
}

// Sign out function
function signOut() {
    if (confirm('Are you sure you want to sign out?')) {
        auth.signOut().then(() => {
            localStorage.removeItem('user');
            window.location.href = 'auth.html';
        }).catch((error) => {
            console.error('Sign out error:', error);
            alert('Failed to sign out. Please try again.');
        });
    }
}

// Event listeners for authentication
document.addEventListener('DOMContentLoaded', function() {
    // Display user info
    displayUserInfo();
    
    // Sign out button
    const signOutBtn = document.getElementById('signOutBtn');
    if (signOutBtn) {
        signOutBtn.addEventListener('click', signOut);
    }
    
    // Profile button - could show profile modal
    const profileBtn = document.getElementById('profileBtn');
    if (profileBtn) {
        profileBtn.addEventListener('click', function() {
            alert(`Signed in as: ${currentUser.name}\nEmail: ${currentUser.email}\nUID: ${currentUser.uid}`);
        });
    }
});

function openMobileAboutScreen() {
    const screen = document.getElementById('mobileAboutScreen');
    if (!screen) return;
    
    screen.classList.add('active');
    screen.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
}

function closeMobileAboutScreen() {
    const screen = document.getElementById('mobileAboutScreen');
    if (!screen) return;
    screen.classList.remove('active');
    screen.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
}

// (mobile screen event listeners moved into main DOMContentLoaded)
