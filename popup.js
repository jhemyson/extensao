document.addEventListener('DOMContentLoaded', () => {
    // Carregar URLs e status inicial
    loadSavedUrls();
    loadCurrentLogs();
    setupEventListeners();
    startLogUpdates();
});

function setupEventListeners() {
    // Adicionar URL
    document.getElementById('addUrlFilter').addEventListener('click', addNewUrlFilter);
    
    // Start/Stop monitoring
    document.getElementById('startMonitoring').addEventListener('click', toggleMonitoring);
    
    // Clear logs
    document.getElementById('clearLogs').addEventListener('click', clearLogs);
    
    // Export logs
    document.getElementById('exportLogs').addEventListener('click', exportLogs);
    
    // Export logs in raw format
    document.getElementById('exportLogsRaw').addEventListener('click', exportLogsRaw);
    
    // Filtros de log
    document.querySelectorAll('.filters input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', applyFilters);
    });
    
    // Filtro de status
    document.getElementById('statusFilter')?.addEventListener('change', applyFilters);
    
    // Tabs
    document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', () => switchTab(button));
    });
}

function addNewUrlFilter() {
    const urlInput = document.getElementById('urlFilter');
    const matchType = document.getElementById('urlMatchType');
    const url = urlInput.value.trim();
    
    if (url) {
        const filter = {
            url: url,
            type: matchType.value,
            active: true
        };

        chrome.storage.local.get(['urlFilters'], (result) => {
            const filters = result.urlFilters || [];
            filters.push(filter);
            
            chrome.storage.local.set({ urlFilters: filters }, () => {
                updateUrlFiltersList(filters);
                urlInput.value = '';
            });
        });
    }
}

function createFilterItem(filter, index) {
    const div = document.createElement('div');
    div.className = `filter-item ${filter.active ? 'active' : 'inactive'}`;
    
    const filterInfo = document.createElement('div');
    filterInfo.className = 'filter-info';
    
    const urlSpan = document.createElement('span');
    urlSpan.className = 'filter-url';
    urlSpan.textContent = filter.url;
    
    const typeSpan = document.createElement('span');
    typeSpan.className = 'filter-type';
    typeSpan.textContent = `(${filter.type})`;
    
    const controls = document.createElement('div');
    controls.className = 'filter-controls';
    
    const label = document.createElement('label');
    label.className = 'switch';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = filter.active;
    checkbox.addEventListener('change', () => toggleUrlFilter(index));
    
    const slider = document.createElement('span');
    slider.className = 'slider';
    
    const removeButton = document.createElement('button');
    removeButton.className = 'remove-btn';
    removeButton.setAttribute('title', 'Remover filtro');
    removeButton.innerHTML = '<i class="fas fa-trash"></i>';
    removeButton.addEventListener('click', () => removeUrlFilter(index));
    
    label.appendChild(checkbox);
    label.appendChild(slider);
    
    filterInfo.appendChild(urlSpan);
    filterInfo.appendChild(typeSpan);
    
    controls.appendChild(label);
    controls.appendChild(removeButton);
    
    div.appendChild(filterInfo);
    div.appendChild(controls);
    
    return div;
}

function updateUrlFiltersList(filters) {
    const list = document.getElementById('urlFiltersList');
    if (!list) return;
    
    list.innerHTML = '';
    filters.forEach((filter, index) => {
        list.appendChild(createFilterItem(filter, index));
    });
}

// Função para remover URL filter
function removeUrlFilter(index) {
    chrome.storage.local.get(['urlFilters'], (result) => {
        const filters = result.urlFilters || [];
        filters.splice(index, 1);
        chrome.storage.local.set({ urlFilters: filters }, () => {
            updateUrlFiltersList(filters);
        });
    });
}

// Função para toggle URL filter
function toggleUrlFilter(index) {
    chrome.storage.local.get(['urlFilters'], (result) => {
        const filters = result.urlFilters || [];
        filters[index].active = !filters[index].active;
        chrome.storage.local.set({ urlFilters: filters }, () => {
            updateUrlFiltersList(filters);
        });
    });
}

function loadSavedUrls() {
    chrome.storage.local.get(['urlFilters', 'monitoring'], (result) => {
        if (result.urlFilters) {
            updateUrlFiltersList(result.urlFilters);
        }
        
        const monitoringBtn = document.getElementById('startMonitoring');
        if (monitoringBtn) {
            monitoringBtn.textContent = result.monitoring ? 'Stop Monitoring' : 'Start Monitoring';
            monitoringBtn.classList.toggle('active', result.monitoring);
        }
    });
}

function toggleMonitoring() {
    chrome.storage.local.get(['monitoring'], (result) => {
        const newState = !result.monitoring;
        chrome.storage.local.set({ monitoring: newState });
        
        const btn = document.getElementById('startMonitoring');
        if (btn) {
            btn.textContent = newState ? 'Stop Monitoring' : 'Start Monitoring';
            btn.classList.toggle('active', newState);
        }
    });
}

function clearLogs() {
    chrome.runtime.sendMessage({ action: 'clearLogs' }, () => {
        document.getElementById('logsList').innerHTML = '';
        document.getElementById('networkList').innerHTML = '';
    });
}

function exportLogs() {
    chrome.runtime.sendMessage({ action: 'exportLogs' });
}

function exportLogsRaw() {
    chrome.runtime.sendMessage({ action: 'exportLogsRaw' });
}

function applyFilters() {
    chrome.storage.local.get(['logs'], (result) => {
        updateLogs(result.logs || []);
    });
}

function updateLogs(logs) {
    const activeTab = document.querySelector('.tab-button.active')?.dataset.tab;
    if (!activeTab) return;

    const consoleContainer = document.getElementById('logsList');
    const networkContainer = document.getElementById('networkList');

    // Filtrar logs por tipo
    const consoleLogs = logs.filter(log => log.type === 'console');
    const networkLogs = logs.filter(log => log.type === 'network');

    // Aplicar filtros ativos
    const filteredConsoleLogs = filterConsoleLogs(consoleLogs);
    const filteredNetworkLogs = filterNetworkLogs(networkLogs);

    // Atualizar containers
    if (activeTab === 'logs') {
        consoleContainer.innerHTML = filteredConsoleLogs.map(createConsoleLogEntry).join('');
    } else if (activeTab === 'network') {
        networkContainer.innerHTML = filteredNetworkLogs.map(createNetworkLogEntry).join('');
    }
}

function filterConsoleLogs(logs) {
    const activeTypes = Array.from(document.querySelectorAll('#logs-tab input[type="checkbox"]:checked'))
        .map(cb => cb.value);
    
    // Tratar logs AICC
    return logs.filter(log => {
        // Se for AICC log e o filtro estiver ativo
        if (log.isAICCLog || log.logType === 'aicclog') {
            return activeTypes.includes('aicclog');
        }
        // Filtro normal para outros tipos
        return activeTypes.includes(log.level);
    }).reverse();
}

function filterNetworkLogs(logs) {
    const activeMethods = Array.from(document.querySelectorAll('#network-tab input[type="checkbox"]:checked'))
        .map(cb => cb.value);
    const statusFilter = document.getElementById('statusFilter')?.value;

    // Inverte a ordem dos logs após filtrar
    return logs.filter(log => {
        const methodMatch = activeMethods.includes(log.method);
        const statusMatch = statusFilter === 'all' || 
            (log.status && log.status.toString().startsWith(statusFilter[0]));
        return methodMatch && statusMatch;
    }).reverse();
}

function createConsoleLogEntry(log) {
    // Para logs AICC ou quando formato bruto estiver ativado
    if ((log.isAICCLog || log.logType === 'aicclog') || document.getElementById('showRawFormat')?.checked) {
        const displayText = log.rawFormat || log.message || JSON.stringify(log);
        
        return `
            <div class="log-entry ${log.logType || log.level} ${log.isAICCLog ? 'aicc-log' : ''}">
                <pre>${escapeHtml(displayText)}</pre>
            </div>
        `;
    }
    
    // Formato estruturado (original) para outros logs
    return `
        <div class="log-entry ${log.level}">
            <span class="time">${new Date(log.timestamp).toLocaleTimeString()}</span>
            <span class="url">${log.url}</span>
            <span class="message">${escapeHtml(log.message)}</span>
        </div>
    `;
}

function createNetworkLogEntry(log) {
    return `
        <div class="network-entry">
            <span class="method ${log.method}">${log.method}</span>
            <span class="status ${getStatusClass(log.status)}">${log.status || 'pending'}</span>
            <span class="url">${log.url}</span>
            <span class="time">${new Date(log.timestamp).toLocaleTimeString()}</span>
        </div>
    `;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getStatusClass(status) {
    if (!status) return '';
    if (status >= 200 && status < 300) return 'success';
    if (status >= 300 && status < 400) return 'redirect';
    if (status >= 400 && status < 500) return 'client-error';
    if (status >= 500) return 'server-error';
    return '';
}

function switchTab(button) {
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));
    
    button.classList.add('active');
    document.getElementById(`${button.dataset.tab}-tab`).classList.remove('hidden');
    
    applyFilters(); // Reaplica os filtros ao mudar de tab
}

// Atualizar logs em tempo real
chrome.storage.onChanged.addListener((changes) => {
    if (changes.logs) {
        updateLogs(changes.logs.newValue || []);
    }
});

// Adiciona as funções ao escopo global para que possam ser chamadas pelos eventos inline
window.removeUrlFilter = removeUrlFilter;
window.toggleUrlFilter = toggleUrlFilter;

function startLogUpdates() {
    // Atualizar logs a cada segundo
    setInterval(loadCurrentLogs, 1000);

    // Escutar por atualizações do background script
    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === 'newLog' || message.action === 'updateLog') {
            loadCurrentLogs();
        }
    });
}

function loadCurrentLogs() {
    chrome.storage.local.get(['currentLogs'], (result) => {
        const logs = result.currentLogs || [];
        updateLogs(logs);
    });
} 