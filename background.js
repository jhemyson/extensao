let monitoring = false;
let urlFilters = [];
let logFilters = {
  error: true,
  warning: true,
  info: true,
  debug: false
};
let networkFilters = {
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  statusCodes: ['2xx', '3xx', '4xx', '5xx']
};
let logsBuffer = [];
const MAX_BUFFER_SIZE = 1000; // Número máximo de logs antes de salvar em arquivo

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    urlFilters: [],
    logFilters,
    networkFilters,
    monitoring: false,
    currentLogs: []
  });
});

// Função atualizada para salvar logs em arquivo
function saveLogsToFile(logs) {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logContent = JSON.stringify(logs, null, 2);
        
        // Dividir os logs em chunks menores se necessário
        const MAX_CHUNK_SIZE = 500000; // ~500KB por chunk
        const chunks = [];
        
        for (let i = 0; i < logContent.length; i += MAX_CHUNK_SIZE) {
            chunks.push(logContent.slice(i, i + MAX_CHUNK_SIZE));
        }
        
        // Salvar cada chunk como um arquivo separado
        chunks.forEach((chunk, index) => {
            const filename = chunks.length > 1 
                ? `logs-${timestamp}-part${index + 1}.log`
                : `logs-${timestamp}.log`;

            const blob = new Blob([chunk], { type: 'application/json' });
            const reader = new FileReader();
            
            reader.onload = function() {
                chrome.downloads.download({
                    url: reader.result,
                    filename: filename,
                    saveAs: false
                });
            };
            
            reader.readAsDataURL(blob);
        });

        // Limpar buffer após salvar com sucesso
        if (logs === logsBuffer) {
            logsBuffer = [];
            chrome.storage.local.set({ currentLogs: [] });
        }
    } catch (error) {
        console.error('Erro ao salvar logs:', error);
    }
}

// Função para adicionar log ao buffer
function addLog(log) {
    const newLog = {
        ...log,
        timestamp: new Date().toISOString()
    };

    logsBuffer.push(newLog);

    // Atualizar storage para a interface
    chrome.storage.local.set({ currentLogs: logsBuffer });

    // Se o buffer atingir o tamanho máximo, salvar em arquivo
    if (logsBuffer.length >= MAX_BUFFER_SIZE) {
        const logsToSave = [...logsBuffer]; // Criar cópia do buffer
        saveLogsToFile(logsToSave);
    }

    // Notificar popup sobre novo log
    chrome.runtime.sendMessage({ 
        action: 'newLog', 
        log: newLog 
    }).catch(() => {}); // Ignora erro se popup não estiver aberto
}

// Monitorar requisições de rede
chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
        chrome.storage.local.get(['monitoring', 'urlFilters'], (result) => {
            if (!result.monitoring) return;

            const filters = result.urlFilters || [];
            const matchesFilter = filters.some(filter => {
                if (!filter.active) return false;
                
                switch (filter.type) {
                    case 'contains':
                        return details.url.includes(filter.url);
                    case 'exact':
                        return details.url === filter.url;
                    case 'regex':
                        try {
                            return new RegExp(filter.url).test(details.url);
                        } catch (e) {
                            return false;
                        }
                }
            });

            if (matchesFilter) {
                addLog({
                    type: 'network',
                    method: details.method,
                    url: details.url,
                    requestId: details.requestId,
                    status: 'pending'
                });
            }
        });
    },
    { urls: ["<all_urls>"] }
);

// Monitorar respostas de rede
chrome.webRequest.onCompleted.addListener(
    (details) => {
        const logIndex = logsBuffer.findIndex(log => 
            log.type === 'network' && log.requestId === details.requestId
        );

        if (logIndex !== -1) {
            logsBuffer[logIndex].status = details.statusCode;
            logsBuffer[logIndex].timeCompleted = new Date().toISOString();
            chrome.storage.local.set({ currentLogs: logsBuffer });
            
            // Notificar popup sobre atualização
            chrome.runtime.sendMessage({ 
                action: 'updateLog', 
                logIndex: logIndex,
                log: logsBuffer[logIndex]
            }).catch(() => {});
        }
    },
    { urls: ["<all_urls>"] }
);

// Receber mensagens do content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'console') {
        chrome.storage.local.get(['monitoring', 'urlFilters'], (result) => {
            if (!result.monitoring) return;

            const filters = result.urlFilters || [];
            const matchesFilter = filters.some(filter => {
                if (!filter.active) return false;
                return sender.tab.url.includes(filter.url);
            });

            if (matchesFilter) {
                addLog({
                    type: 'console',
                    level: message.logType,
                    message: message.message,
                    url: sender.tab.url
                });
            }
        });
    } else if (message.action === 'clearLogs') {
        logsBuffer = [];
        chrome.storage.local.set({ currentLogs: [] });
        sendResponse({ success: true });
    } else if (message.action === 'exportLogs') {
        const logsToExport = [...logsBuffer]; // Criar cópia do buffer
        saveLogsToFile(logsToExport);
        sendResponse({ success: true });
    } else if (message.action === 'getLogs') {
        sendResponse({ logs: logsBuffer });
    }
    
    return true; // Mantém a conexão aberta para respostas assíncronas
});

// Salvar logs periodicamente (a cada 5 minutos)
setInterval(() => {
    if (logsBuffer.length > 0) {
        const logsToSave = [...logsBuffer]; // Criar cópia do buffer
        saveLogsToFile(logsToSave);
    }
}, 5 * 60 * 1000); 