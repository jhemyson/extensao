// Interceptar console.logs
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info,
  debug: console.debug
};

// Função para formatar mensagens de erro
function formatError(error) {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      name: error.name,
      fileName: error.fileName,
      lineNumber: error.lineNumber,
      columnNumber: error.columnNumber
    };
  }
  return error;
}

// Função para enviar log
function sendLog(type, data) {
  try {
    const logData = {
      type: 'console',
      logType: type,
      timestamp: new Date().toISOString(),
      url: window.location.href
    };

    if (typeof data === 'string') {
      logData.message = data;
    } else if (data instanceof Error) {
      logData.error = formatError(data);
      logData.message = data.message;
    } else if (Array.isArray(data)) {
      logData.message = data.map(item => {
        if (item instanceof Error) {
          return formatError(item);
        }
        return typeof item === 'object' ? JSON.stringify(item) : String(item);
      }).join(' ');
    } else if (typeof data === 'object') {
      logData.message = JSON.stringify(data, null, 2);
    } else {
      logData.message = String(data);
    }

    chrome.runtime.sendMessage(logData).catch(() => {});
  } catch (e) {
    // Fallback para console original em caso de erro
    originalConsole.error('Error sending log:', e);
  }
}

// Interceptar erros não capturados
window.addEventListener('error', function(event) {
  const errorData = {
    message: event.message,
    source: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: event.error ? formatError(event.error) : null,
    type: 'error'
  };
  sendLog('error', errorData);
}, true);

// Interceptar promessas rejeitadas não tratadas
window.addEventListener('unhandledrejection', function(event) {
  const errorData = {
    message: 'Unhandled Promise Rejection',
    reason: event.reason ? formatError(event.reason) : 'Unknown reason',
    type: 'unhandledrejection'
  };
  sendLog('error', errorData);
}, true);

// Interceptar erros de CSP
document.addEventListener('securitypolicyviolation', function(event) {
  const cspData = {
    message: `CSP violation: ${event.violatedDirective}`,
    blockedURI: event.blockedURI,
    directive: event.violatedDirective,
    disposition: event.disposition,
    documentURI: event.documentURI,
    effectiveDirective: event.effectiveDirective,
    originalPolicy: event.originalPolicy,
    referrer: event.referrer,
    statusCode: event.statusCode,
    type: 'CSP'
  };
  sendLog('error', cspData);
}, true);

// Interceptar console methods
function interceptConsole(type) {
  console[type] = (...args) => {
    // Manter comportamento original
    originalConsole[type].apply(console, args);
    sendLog(type, args);
  };
}

['log', 'error', 'warn', 'info', 'debug'].forEach(interceptConsole);

// Monitorar falhas de carregamento de recursos
function observeResourceErrors() {
  const observer = new PerformanceObserver((list) => {
    list.getEntries().forEach((entry) => {
      if (entry.entryType === 'resource' && !entry.responseStatus) {
        sendLog('error', {
          message: `Resource failed to load: ${entry.name}`,
          type: 'ResourceError',
          duration: entry.duration,
          initiatorType: entry.initiatorType,
          nextHopProtocol: entry.nextHopProtocol
        });
      }
    });
  });

  observer.observe({ entryTypes: ['resource'] });
}

// Monitorar elementos que falham ao carregar
function observeDOMErrors() {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.tagName) {
          const tagName = node.tagName.toLowerCase();
          if (['img', 'script', 'link', 'iframe'].includes(tagName)) {
            node.addEventListener('error', (event) => {
              sendLog('error', {
                message: `Failed to load ${tagName}: ${node.src || node.href}`,
                type: 'ResourceError',
                element: tagName
              });
            });
          }
        }
      });
    });
  });

  observer.observe(document, {
    childList: true,
    subtree: true
  });
}

// Inicializar observadores
observeResourceErrors();
observeDOMErrors();

// Notificar carregamento da página
window.addEventListener('load', () => {
  sendLog('info', 'Page loaded');
});

// Escutar eventos do console interceptado pelo script injetado
document.addEventListener('console_log_captured', function(event) {
    const detail = event.detail;
    
    // Determinar o nível de log com base no tipo
    let logLevel = 'info';
    if (detail.type === 'error') logLevel = 'error';
    else if (detail.type === 'warn') logLevel = 'warning';
    else if (detail.type === 'debug') logLevel = 'debug';
    
    // Adicionar informação se é um log especial
    let message = detail.text;
    if (detail.isAICCLog) {
        message = `[AICC_SPECIAL] ${message}`;
    }
    
    // Enviar para o background script
    chrome.runtime.sendMessage({
        type: 'console',
        logType: logLevel,
        message: message,
        timestamp: detail.timestamp
    });
});

// Escutar eventos de detecção de scripts AICC
document.addEventListener('aicc_script_detected', function(event) {
    chrome.runtime.sendMessage({
        type: 'console',
        logType: 'info',
        message: `[AICC_SCRIPT_DETECTED] ${event.detail.src}`,
        timestamp: new Date().toISOString()
    });
});

// Monitorar scripts injetados dinamicamente
function monitorDynamicScripts() {
    // 1. Interceptar createElement para detectar criação de scripts
    const originalCreateElement = document.createElement;
    document.createElement = function(tagName) {
        const element = originalCreateElement.apply(document, arguments);
        if (tagName.toLowerCase() === 'script') {
            // Monitorar quando o script é adicionado ao DOM
            const observer = new MutationObserver((mutations) => {
                if (document.contains(element)) {
                    // Script foi adicionado ao DOM
                    chrome.runtime.sendMessage({
                        type: 'console',
                        logType: 'info',
                        message: `[DYNAMIC_SCRIPT_ADDED] ${element.src || 'inline script'}`,
                        timestamp: new Date().toISOString()
                    });
                    
                    // Se for um script inline, capturar seu conteúdo
                    if (!element.src && element.textContent) {
                        // Verificar se o script contém console.log ou outras funções de interesse
                        const scriptContent = element.textContent;
                        if (scriptContent.includes('console.log') || 
                            scriptContent.includes('console.error') || 
                            scriptContent.includes('this.queryAgentTaskList') ||
                            scriptContent.includes('ccagent')) {
                            
                            chrome.runtime.sendMessage({
                                type: 'console',
                                logType: 'info',
                                message: `[DYNAMIC_SCRIPT_CONTENT] Script contém funções de interesse`,
                                timestamp: new Date().toISOString()
                            });
                        }
                    }
                    
                    observer.disconnect();
                }
            });
            
            observer.observe(document, { subtree: true, childList: true });
        }
        return element;
    };
    
    // 2. Interceptar a API fetch para monitorar carregamentos de JavaScript
    const originalFetch = window.fetch;
    window.fetch = function() {
        const url = arguments[0];
        const promise = originalFetch.apply(this, arguments);
        
        // Se a URL termina com .js, monitorar a resposta
        if (typeof url === 'string' && url.endsWith('.js')) {
            chrome.runtime.sendMessage({
                type: 'console',
                logType: 'info',
                message: `[FETCH_JS] ${url}`,
                timestamp: new Date().toISOString()
            });
            
            // Clonar a resposta para analisar
            promise.then(response => {
                response.clone().text().then(text => {
                    // Verificar se o conteúdo contém funções de interesse
                    if (text.includes('console.log') || 
                        text.includes('console.error') || 
                        text.includes('this.queryAgentTaskList') ||
                        text.includes('ccagent')) {
                        
                        chrome.runtime.sendMessage({
                            type: 'console',
                            logType: 'info',
                            message: `[JS_CONTENT] ${url} contém funções de interesse`,
                            timestamp: new Date().toISOString()
                        });
                    }
                }).catch(() => {});
            }).catch(() => {});
        }
        
        return promise;
    };
    
    // 3. Interceptar XMLHttpRequest para monitorar carregamentos de JavaScript
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function() {
        const url = arguments[1];
        
        if (typeof url === 'string' && url.endsWith('.js')) {
            this.addEventListener('load', function() {
                if (this.readyState === 4) {
                    chrome.runtime.sendMessage({
                        type: 'console',
                        logType: 'info',
                        message: `[XHR_JS] ${url}`,
                        timestamp: new Date().toISOString()
                    });
                    
                    // Verificar se o conteúdo contém funções de interesse
                    const responseText = this.responseText;
                    if (responseText.includes('console.log') || 
                        responseText.includes('console.error') || 
                        responseText.includes('this.queryAgentTaskList') ||
                        responseText.includes('ccagent')) {
                        
                        chrome.runtime.sendMessage({
                            type: 'console',
                            logType: 'info',
                            message: `[JS_CONTENT] ${url} contém funções de interesse`,
                            timestamp: new Date().toISOString()
                        });
                    }
                }
            });
        }
        
        return originalOpen.apply(this, arguments);
    };
    
    // 4. Monitorar eval e Function para detectar código JavaScript executado dinamicamente
    const originalEval = window.eval;
    window.eval = function(code) {
        chrome.runtime.sendMessage({
            type: 'console',
            logType: 'info',
            message: `[EVAL_EXECUTED] Tamanho: ${code.length} caracteres`,
            timestamp: new Date().toISOString()
        });
        
        // Verificar se o código contém funções de interesse
        if (code.includes('console.log') || 
            code.includes('console.error') || 
            code.includes('this.queryAgentTaskList') ||
            code.includes('ccagent')) {
            
            chrome.runtime.sendMessage({
                type: 'console',
                logType: 'info',
                message: `[EVAL_CONTENT] Contém funções de interesse`,
                timestamp: new Date().toISOString()
            });
        }
        
        return originalEval.apply(this, arguments);
    };
    
    const originalFunction = window.Function;
    window.Function = function() {
        const newFunc = originalFunction.apply(this, arguments);
        
        chrome.runtime.sendMessage({
            type: 'console',
            logType: 'info',
            message: `[FUNCTION_CONSTRUCTOR] Nova função criada dinamicamente`,
            timestamp: new Date().toISOString()
        });
        
        // Verificar se os argumentos contêm funções de interesse
        const args = Array.from(arguments).join(' ');
        if (args.includes('console.log') || 
            args.includes('console.error') || 
            args.includes('this.queryAgentTaskList') ||
            args.includes('ccagent')) {
            
            chrome.runtime.sendMessage({
                type: 'console',
                logType: 'info',
                message: `[FUNCTION_CONTENT] Contém funções de interesse`,
                timestamp: new Date().toISOString()
            });
        }
        
        return newFunc;
    };
}

// Modificar a função injectScript para incluir monitoramento de recursos
function injectScript() {
    const script = document.createElement('script');
    script.textContent = `
    (function() {
      // Salvar referências originais
      const originalConsole = {
        log: console.log,
        error: console.error,
        warn: console.warn,
        info: console.info,
        debug: console.debug
      };

      // Função para capturar qualquer log
      function captureConsoleOutput(type, args) {
        try {
          // Converter args para texto
          let logText = '';
          try {
            logText = Array.from(args).map(arg => {
              if (arg instanceof Error) return arg.toString();
              return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
            }).join(' ');
          } catch (e) {
            logText = String(args);
          }

          // Verificar se é um log AICC ou do tipo que estamos procurando
          const isSpecialLog = logText.includes('[AICCLOG') || 
                              logText.includes('this.queryAgentTaskList') ||
                              logText.includes('ccagent.requestAgentEvent') ||
                              logText.includes('agentStatus') ||
                              logText.includes('index-BN_Wr1AE.js');

          // Enviar todos os logs para o content script
          document.dispatchEvent(new CustomEvent('console_log_captured', {
            detail: { 
              type: type, 
              text: logText,
              timestamp: new Date().toISOString(),
              isAICCLog: isSpecialLog
            }
          }));
        } catch (e) {
          // Ignorar erros na captura
        }
      }

      // Substituir todas as funções do console
      console.log = function() {
        originalConsole.log.apply(console, arguments);
        captureConsoleOutput('log', arguments);
      };

      console.error = function() {
        originalConsole.error.apply(console, arguments);
        captureConsoleOutput('error', arguments);
      };

      console.warn = function() {
        originalConsole.warn.apply(console, arguments);
        captureConsoleOutput('warn', arguments);
      };

      console.info = function() {
        originalConsole.info.apply(console, arguments);
        captureConsoleOutput('info', arguments);
      };

      console.debug = function() {
        originalConsole.debug.apply(console, arguments);
        captureConsoleOutput('debug', arguments);
      };

      // Capturar erros não tratados também
      window.addEventListener('error', function(event) {
        captureConsoleOutput('error', [event.error || event.message]);
      });

      // Inspecionar o DOM em busca de elementos de script específicos
      function checkForAICCScripts() {
        const scripts = document.querySelectorAll('script');
        scripts.forEach(script => {
          const src = script.src || '';
          if (src.includes('index-BN_Wr1AE.js') || 
              src.includes('aicccloud.com') || 
              src.includes('aicc-web')) {
            document.dispatchEvent(new CustomEvent('aicc_script_detected', {
              detail: { src }
            }));
          }
        });
      }

      // Verificar scripts existentes e adicionar um MutationObserver para novos scripts
      checkForAICCScripts();
      const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
          if (mutation.addedNodes) {
            mutation.addedNodes.forEach(node => {
              if (node.nodeType === 1 && node.tagName === 'SCRIPT') {
                const src = node.src || '';
                if (src.includes('index-BN_Wr1AE.js') || 
                    src.includes('aicccloud.com') || 
                    src.includes('aicc-web')) {
                  document.dispatchEvent(new CustomEvent('aicc_script_detected', {
                    detail: { src }
                  }));
                }
              }
            });
          }
        });
      });
      
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });

      // Notificar que o interceptor foi configurado
      document.dispatchEvent(new CustomEvent('console_interceptor_ready'));
    })();
    `;
    
    document.documentElement.appendChild(script);
    script.remove();

    // Adicionar monitoramento de recursos JavaScript
    const resourceMonitorScript = document.createElement('script');
    resourceMonitorScript.textContent = `
    (function() {
        // Monitorar carregamento de recursos
        const originalCreateElement = document.createElement;
        document.createElement = function(tagName) {
            const element = originalCreateElement.apply(document, arguments);
            if (tagName.toLowerCase() === 'script') {
                element.addEventListener('load', function() {
                    document.dispatchEvent(new CustomEvent('script_loaded', {
                        detail: { src: element.src || 'inline script' }
                    }));
                });
                
                element.addEventListener('error', function() {
                    document.dispatchEvent(new CustomEvent('script_error', {
                        detail: { src: element.src || 'inline script' }
                    }));
                });
            }
            return element;
        };
        
        // Monitorar execução de scripts
        const originalAppendChild = Node.prototype.appendChild;
        Node.prototype.appendChild = function(node) {
            if (node.tagName === 'SCRIPT') {
                document.dispatchEvent(new CustomEvent('script_appended', {
                    detail: { src: node.src || 'inline script' }
                }));
            }
            return originalAppendChild.apply(this, arguments);
        };
        
        // Monitorar execução de eval
        const originalEval = window.eval;
        window.eval = function(code) {
            document.dispatchEvent(new CustomEvent('eval_executed', {
                detail: { codeLength: code.length }
            }));
            return originalEval.apply(this, arguments);
        };
    })();
    `;
    
    document.documentElement.appendChild(resourceMonitorScript);
    resourceMonitorScript.remove();
}

// Injetar o script quando a página carregar
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectScript);
} else {
    injectScript();
}

// Interceptar console.* chamadas
console.log = function() {
    originalConsole.log.apply(console, arguments);
    sendToBackground('info', Array.from(arguments).join(' '));
};

console.error = function() {
    originalConsole.error.apply(console, arguments);
    sendToBackground('error', Array.from(arguments).join(' '));
};

console.warn = function() {
    originalConsole.warn.apply(console, arguments);
    sendToBackground('warning', Array.from(arguments).join(' '));
};

console.info = function() {
    originalConsole.info.apply(console, arguments);
    sendToBackground('info', Array.from(arguments).join(' '));
};

console.debug = function() {
    originalConsole.debug.apply(console, arguments);
    sendToBackground('debug', Array.from(arguments).join(' '));
};

function sendToBackground(logType, message) {
    chrome.runtime.sendMessage({
        type: 'console',
        logType: logType,
        message: message
    });
}

// Adicionar listeners para eventos de recursos
document.addEventListener('script_loaded', function(event) {
    chrome.runtime.sendMessage({
        type: 'console',
        logType: 'info',
        message: `[SCRIPT_LOADED] ${event.detail.src}`,
        timestamp: new Date().toISOString()
    });
});

document.addEventListener('script_error', function(event) {
    chrome.runtime.sendMessage({
        type: 'console',
        logType: 'error',
        message: `[SCRIPT_ERROR] ${event.detail.src}`,
        timestamp: new Date().toISOString()
    });
});

document.addEventListener('script_appended', function(event) {
    chrome.runtime.sendMessage({
        type: 'console',
        logType: 'info',
        message: `[SCRIPT_APPENDED] ${event.detail.src}`,
        timestamp: new Date().toISOString()
    });
});

document.addEventListener('eval_executed', function(event) {
    chrome.runtime.sendMessage({
        type: 'console',
        logType: 'info',
        message: `[EVAL_EXECUTED] Tamanho: ${event.detail.codeLength} caracteres`,
        timestamp: new Date().toISOString()
    });
});

// Iniciar monitoramento de scripts dinâmicos
monitorDynamicScripts(); 