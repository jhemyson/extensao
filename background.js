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
    // Garantir que temos um timestamp
    if (!log.timestamp) {
        log.timestamp = Date.now();
    }
    
    // Formatar o log de maneira mais pura possível
    let pureLog = {
        ...log,
        rawTimestamp: new Date(log.timestamp).toISOString(),
        rawMessage: log.message
    };
    
    // Adicionar ao buffer
    logsBuffer.push(pureLog);
    
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
        log: pureLog 
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

// Configurar a API chrome.debugger para capturar todos os logs
function setupDebugger() {
    chrome.debugger.onEvent.addListener(onDebuggerEvent);
    
    // Inicializar o cache de URLs
    chrome.tabs.query({}, function(tabs) {
        tabs.forEach(function(tab) {
            tabUrlCache[tab.id] = tab.url;
            attachDebugger(tab.id);
        });
    });
    
    // Monitorar novas abas
    chrome.tabs.onCreated.addListener(function(tab) {
        tabUrlCache[tab.id] = tab.url;
        attachDebugger(tab.id);
    });
    
    // Monitorar navegação para reattach do debugger quando necessário
    chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
        if (changeInfo.status === 'complete') {
            // Reattach debugger quando a página terminar de carregar
            chrome.debugger.detach({tabId: tabId}, function() {
                attachDebugger(tabId);
            });
        }
    });
}

// Melhorar a função attachDebugger para capturar todos os eventos de console
function attachDebugger(tabId) {
    chrome.debugger.attach({tabId: tabId}, '1.3', function() {
        if (chrome.runtime.lastError) {
            console.error('Erro ao anexar debugger:', chrome.runtime.lastError);
            return;
        }
        
        // Habilitar domínios relacionados ao console
        chrome.debugger.sendCommand({tabId: tabId}, 'Console.enable');
        chrome.debugger.sendCommand({tabId: tabId}, 'Runtime.enable');
        chrome.debugger.sendCommand({tabId: tabId}, 'Log.enable');
        
        // Configurar para capturar todos os tipos de mensagens do console
        chrome.debugger.sendCommand({tabId: tabId}, 'Runtime.setAsyncCallStackDepth', {maxDepth: 32});
        chrome.debugger.sendCommand({tabId: tabId}, 'Console.setTimestampsEnabled', {enabled: true});
        
        // Capturar também eventos de rede que aparecem no console
        chrome.debugger.sendCommand({tabId: tabId}, 'Network.enable');
    });
}

// Modificar a função onDebuggerEvent para capturar logs de scripts.js
function onDebuggerEvent(debuggeeId, message, params) {
    // Verificar se o monitoramento está ativo
    chrome.storage.local.get(['monitoring', 'urlFilters'], (result) => {
        if (!result.monitoring) return;
        
        let log = null;
        let url = '';
        let sourceUrl = '';
        
        // Obter a URL da aba atual
        sourceUrl = getTabUrl(debuggeeId.tabId) || '';
        
        // Capturar todos os tipos de mensagens do console
        if (message === 'Console.messageAdded') {
            // Mensagens diretas do console
            url = params.message.url || sourceUrl || 'unknown';
            log = {
                type: 'console',
                level: normalizeLogLevel(params.message.level || 'info'),
                message: params.message.text,
                url: url,
                sourceUrl: sourceUrl,
                scriptUrl: url.endsWith('.js') ? url : null,
                timestamp: Date.now(),
                rawData: JSON.stringify(params.message)
            };
        } else if (message === 'Runtime.consoleAPICalled') {
            // Chamadas à API do console (console.log, console.error, etc.)
            url = params.context || sourceUrl || 'unknown';
            
            // Extrair a mensagem completa dos argumentos
            const args = params.args || [];
            const messageTexts = args.map(arg => {
                if (arg.value !== undefined) return String(arg.value);
                if (arg.description !== undefined) return arg.description;
                if (arg.preview) return JSON.stringify(arg.preview);
                return JSON.stringify(arg);
            }).join(' ');
            
            // Tentar obter a URL do script da stack trace
            let scriptUrl = null;
            if (params.stackTrace && params.stackTrace.callFrames && params.stackTrace.callFrames.length > 0) {
                const frame = params.stackTrace.callFrames[0];
                if (frame.url && frame.url.endsWith('.js')) {
                    scriptUrl = frame.url;
                }
            }
            
            log = {
                type: 'console',
                level: normalizeLogLevel(params.type || 'info'),
                message: messageTexts,
                url: url,
                sourceUrl: sourceUrl,
                scriptUrl: scriptUrl,
                timestamp: Date.now(),
                rawData: JSON.stringify(params)
            };
        } else if (message === 'Runtime.exceptionThrown') {
            // Exceções não capturadas que aparecem no console
            url = params.exceptionDetails?.url || sourceUrl || 'unknown';
            
            const exceptionText = params.exceptionDetails?.exception?.description || 
                                 params.exceptionDetails?.text || 
                                 'Exceção desconhecida';
            
            log = {
                type: 'console',
                level: 'error',
                message: `Exceção: ${exceptionText}`,
                url: url,
                sourceUrl: sourceUrl,
                timestamp: Date.now(),
                rawData: JSON.stringify(params)
            };
        } else if (message === 'Log.entryAdded') {
            // Entradas de log gerais
            url = params.entry.url || sourceUrl || 'unknown';
            log = {
                type: 'console',
                level: normalizeLogLevel(params.entry.level || 'info'),
                message: params.entry.text,
                url: url,
                sourceUrl: sourceUrl,
                timestamp: Date.now(),
                rawData: JSON.stringify(params.entry)
            };
        } else if (message === 'Runtime.executionContextCreated' || 
                  message === 'Runtime.executionContextDestroyed') {
            // Eventos de contexto de execução (carregamento/descarregamento de scripts)
            url = sourceUrl || 'unknown';
            log = {
                type: 'console',
                level: 'info',
                message: `Contexto de execução ${message.includes('Created') ? 'criado' : 'destruído'}: ${JSON.stringify(params)}`,
                url: url,
                sourceUrl: sourceUrl,
                timestamp: Date.now(),
                rawData: JSON.stringify(params)
            };
        }
        
        // Se não temos um log para processar, retornar
        if (!log || !url) return;
        
        // Verificar se a URL da página ou do script corresponde a algum dos filtros ativos
        const filters = result.urlFilters || [];
        const matchesFilter = filters.some(filter => {
            if (!filter.active) return false;
            
            // Verificar URL da página, URL do log e URL do script
            const urlsToCheck = [sourceUrl, url];
            if (log.scriptUrl) urlsToCheck.push(log.scriptUrl);
            
            return urlsToCheck.some(urlToCheck => {
                if (!urlToCheck) return false;
                
                switch (filter.type) {
                    case 'contains':
                        return urlToCheck.includes(filter.url);
                    case 'exact':
                        return urlToCheck === filter.url;
                    case 'regex':
                        try {
                            return new RegExp(filter.url).test(urlToCheck);
                        } catch (e) {
                            return false;
                        }
                }
            });
        });
        
        // Adicionar o log apenas se corresponder a um filtro
        if (matchesFilter) {
            addLog(log);
        }
    });
}

// Função para normalizar níveis de log
function normalizeLogLevel(level) {
    // Mapear todos os possíveis níveis de log para os tipos suportados
    const levelMap = {
        'log': 'info',
        'info': 'info',
        'warning': 'warning',
        'warn': 'warning',
        'error': 'error',
        'debug': 'debug',
        'verbose': 'debug',
        'trace': 'debug'
    };
    
    return levelMap[level.toLowerCase()] || 'info';
}

// Cache para URLs de abas
const tabUrlCache = {};

// Função para obter a URL da aba
function getTabUrl(tabId) {
    if (tabUrlCache[tabId]) {
        return tabUrlCache[tabId];
    }
    
    // Tentar obter a URL da aba e armazenar em cache
    chrome.tabs.get(tabId, function(tab) {
        if (tab && tab.url) {
            tabUrlCache[tabId] = tab.url;
        }
    });
    
    return null;
}

// Atualizar o cache de URLs quando as abas mudam
chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
    if (changeInfo.url) {
        tabUrlCache[tabId] = changeInfo.url;
    }
});

// Iniciar o debugger quando o monitoramento for ativado
chrome.storage.onChanged.addListener((changes) => {
    if (changes.monitoring && changes.monitoring.newValue === true) {
        setupDebugger();
    } else if (changes.monitoring && changes.monitoring.newValue === false) {
        // Desanexar o debugger de todas as abas
        chrome.tabs.query({}, function(tabs) {
            tabs.forEach(function(tab) {
                chrome.debugger.detach({tabId: tab.id});
            });
        });
    }
}); 