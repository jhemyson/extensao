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
function saveLogsToFile(logs, format = 'json') {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        let logContent;
        
        if (format === 'raw') {
            // Formato bruto - apenas texto linha a linha
            logContent = logs.map(log => log.rawFormat || JSON.stringify(log)).join('\n');
        } else {
            // Formato JSON estruturado (padrão)
            logContent = JSON.stringify(logs, null, 2);
        }
        
        // Dividir os logs em chunks menores se necessário
        const MAX_CHUNK_SIZE = 500000; // ~500KB por chunk
        const chunks = [];
        
        for (let i = 0; i < logContent.length; i += MAX_CHUNK_SIZE) {
            chunks.push(logContent.slice(i, i + MAX_CHUNK_SIZE));
        }
        
        // Extensão do arquivo baseada no formato
        const fileExt = format === 'raw' ? 'log' : 'json';
        
        // Salvar cada chunk como um arquivo separado
        chunks.forEach((chunk, index) => {
            const filename = chunks.length > 1 
                ? `logs-${timestamp}-${format}-part${index + 1}.${fileExt}`
                : `logs-${timestamp}-${format}.${fileExt}`;

            const blob = new Blob([chunk], { 
                type: format === 'raw' ? 'text/plain' : 'application/json' 
            });
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
    // Verificar se é um log AICC
    if (log.message && (
        log.message.includes('[AICCLOG') || 
        log.message.includes('this.queryAgentTaskList') ||
        log.message.includes('ccagent.requestAgentEvent')
    )) {
        log.isAICCLog = true;
        log.logType = 'aicclog';
    }

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
    try {
        // Se for um log do console (incluindo AICC)
        if (message.type === 'console') {
            // Em vez de verificar filtros de URL para logs AICC, 
            // vamos capturar todos os logs AICC independentemente do filtro
            if (message.isAICCLog) {
                addLog(message);
                // Responder imediatamente
                sendResponse({ success: true });
                return false; // Não esperar por resposta assíncrona
            }

            chrome.storage.local.get(['monitoring', 'urlFilters'], (result) => {
                try {
                    if (!result.monitoring) {
                        sendResponse({ success: false, reason: 'monitoring_disabled' });
                        return;
                    }

                    const filters = result.urlFilters || [];
                    // Se não há filtros ou pelo menos um filtro está ativo, capturar o log
                    if (filters.length === 0 || filters.some(filter => {
                        if (!filter.active) return false;
                        
                        // Verificar se a URL da origem do log corresponde ao filtro
                        const url = sender.tab ? sender.tab.url : message.url;
                        switch (filter.type) {
                            case 'contains':
                                return url.includes(filter.url);
                            case 'exact':
                                return url === filter.url;
                            case 'regex':
                                try {
                                    return new RegExp(filter.url).test(url);
                                } catch (e) {
                                    return false;
                                }
                        }
                    })) {
                        addLog(message);
                        sendResponse({ success: true });
                    } else {
                        sendResponse({ success: false, reason: 'filter_mismatch' });
                    }
                } catch (e) {
                    console.error('Erro ao processar mensagem:', e);
                    sendResponse({ success: false, error: e.message });
                }
            });
            
            // Retornar true apenas se precisarmos de resposta assíncrona
            return true;
        } else if (message.action === 'clearLogs') {
            logsBuffer = [];
            chrome.storage.local.set({ currentLogs: [] });
            sendResponse({ success: true });
            return false;
        } else if (message.action === 'exportLogsRaw') {
            const logsToExport = [...logsBuffer];
            saveLogsToFile(logsToExport, 'raw');
            sendResponse({ success: true });
            return false;
        } else if (message.action === 'exportLogs') {
            const logsToExport = [...logsBuffer];
            saveLogsToFile(logsToExport, 'json');
            sendResponse({ success: true });
            return false;
        } else if (message.action === 'getLogs') {
            sendResponse({ logs: logsBuffer });
            return false;
        }
    } catch (e) {
        console.error('Erro no processamento de mensagem:', e);
        sendResponse({ success: false, error: e.message });
        return false;
    }
    
    // Se chegamos aqui, não soubemos lidar com a mensagem
    sendResponse({ success: false, reason: 'unknown_message_type' });
    return false;
});

// Salvar logs periodicamente (a cada 5 minutos)
setInterval(() => {
    if (logsBuffer.length > 0) {
        const logsToSave = [...logsBuffer]; // Criar cópia do buffer
        saveLogsToFile(logsToSave);
    }
}, 5 * 60 * 1000);

// Verificar se existem logs pendentes armazenados localmente
function checkAndRecoverPendingLogs(tabId) {
  try {
    // Primeiro verificar se a URL é acessível
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        console.log('Erro ao obter informações da tab:', chrome.runtime.lastError);
        return;
      }
      
      // Verificar se é uma URL onde podemos injetar scripts
      if (!tab.url || 
          tab.url.startsWith('chrome://') || 
          tab.url.startsWith('chrome-extension://') || 
          tab.url.startsWith('edge://') ||
          tab.url.startsWith('about:') ||
          tab.url.startsWith('file://') ||
          tab.url.startsWith('data:')) {
        console.log('URL não acessível para recuperação de logs:', tab.url);
        return;
      }
      
      // Agora que sabemos que a URL é segura, executar o script
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: function() {
          try {
            const pendingLogs = localStorage.getItem('extension_pending_logs');
            if (pendingLogs) {
              const logs = JSON.parse(pendingLogs);
              // Limpar logs após recuperá-los
              localStorage.removeItem('extension_pending_logs');
              return logs;
            }
            return null;
          } catch (e) {
            console.error("Erro ao recuperar logs pendentes:", e);
            return null;
          }
        }
      }).then(results => {
        if (results && results[0] && results[0].result) {
          const pendingLogs = results[0].result;
          if (Array.isArray(pendingLogs) && pendingLogs.length > 0) {
            console.log(`Recuperados ${pendingLogs.length} logs pendentes`);
            pendingLogs.forEach(log => {
              addLog(log);
            });
          }
        }
      }).catch(error => {
        console.error("Erro ao executar script de recuperação:", error);
      });
    });
  } catch (e) {
    console.error("Erro ao executar script para recuperar logs:", e);
  }
}

// Adicionar um listener para quando uma tab é atualizada
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') {
        chrome.storage.local.get(['monitoring'], (result) => {
            if (result.monitoring) {
                // Verificar se a URL é acessível (de forma mais robusta)
                if (!tab.url || 
                    tab.url.startsWith('chrome://') || 
                    tab.url.startsWith('chrome-extension://') || 
                    tab.url.startsWith('edge://') ||
                    tab.url.startsWith('about:') ||
                    tab.url.startsWith('file://') ||
                    tab.url.startsWith('data:')) {
                    console.log('URL não acessível para injeção de script:', tab.url);
                    return; // Não tente recuperar logs ou injetar scripts em URLs restritas
                }
                
                // Verificar e recuperar logs pendentes (apenas em URLs permitidas)
                setTimeout(() => {
                    checkAndRecoverPendingLogs(tabId);
                }, 2000);
                
                // Método seguro para injetar script usando a API chrome.scripting
                try {
                    chrome.scripting.executeScript({
                        target: { tabId: tabId },
                        func: function() {
                            document.dispatchEvent(new CustomEvent('page_reloaded'));
                        }
                    }).catch(error => {
                        console.log('Erro na injeção:', error.message);
                    });
                } catch (e) {
                    console.error('Erro ao injetar script:', e);
                }
            }
        });
    }
}); 