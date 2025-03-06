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

// Nova função para capturar o formato bruto original
function captureRawLogFormat(type, args) {
  let prefix = '';
  
  // Tentar detectar se é um log especial como [AICCLOG]
  if (args.length > 0 && typeof args[0] === 'string') {
    const match = args[0].match(/^\[(AICCLOG|.*?)\s/);
    if (match) {
      // Preservar o formato especial exato
      return Array.from(args).map(arg => {
        if (arg instanceof Error) return arg.toString();
        return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
      }).join(' ');
    }
  }
  
  // Para logs comuns, adicionar timestamp similar
  const now = new Date();
  const timestamp = now.toLocaleString('pt-BR');
  prefix = `[${type.toUpperCase()} ${timestamp}] `;
  
  // Formatar o restante da mensagem
  const message = Array.from(args).map(arg => {
    if (arg instanceof Error) return arg.toString();
    return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
  }).join(' ');
  
  return prefix + message;
}

// Função para enviar log
function sendLog(type, args) {
  try {
    // Formato estruturado (JSON) - como já existente
    const logData = {
      type: 'console',
      logType: type,
      timestamp: new Date().toISOString(),
      url: window.location.href
    };

    // Adicionar mensagem processada ao formato estruturado
    if (typeof args[0] === 'string') {
      logData.message = args[0];
    } else if (args[0] instanceof Error) {
      logData.error = formatError(args[0]);
      logData.message = args[0].message;
    } else if (Array.isArray(args)) {
      logData.message = args.map(item => {
        if (item instanceof Error) {
          return formatError(item);
        }
        return typeof item === 'object' ? JSON.stringify(item) : String(item);
      }).join(' ');
    } else if (typeof args[0] === 'object') {
      logData.message = JSON.stringify(args[0], null, 2);
    } else {
      logData.message = String(args[0]);
    }

    // Adicionar o formato bruto
    logData.rawFormat = captureRawLogFormat(type, args);

    // Verificar se o runtime da extensão ainda é válido
    if (chrome.runtime && chrome.runtime.id) {
      chrome.runtime.sendMessage(logData).catch((error) => {
        console.error("Erro ao enviar log para background script:", error);
        
        // Tentar salvar localmente se não puder enviar para o background
        try {
          const logs = JSON.parse(localStorage.getItem('extension_pending_logs') || '[]');
          logs.push(logData);
          localStorage.setItem('extension_pending_logs', JSON.stringify(logs.slice(-100))); // Limite de 100 logs
        } catch (e) {
          // Falha silenciosa se localStorage também falhar
        }
      });
    } else {
      // O contexto da extensão foi invalidado, tentar salvar localmente
      try {
        const logs = JSON.parse(localStorage.getItem('extension_pending_logs') || '[]');
        logs.push(logData);
        localStorage.setItem('extension_pending_logs', JSON.stringify(logs.slice(-100))); // Limite de 100 logs
      } catch (e) {
        // Falha silenciosa se localStorage também falhar
      }
    }
  } catch (e) {
    // Fallback para console original em caso de erro
    try {
      originalConsole.error('Error sending log:', e);
    } catch (e2) {
      // Falha silenciosa se não puder usar console original
    }
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

// Adicionar esta função no início do arquivo, antes de qualquer outra coisa
function setupAdvancedLogCapture() {
  // Capturar logs existentes imediatamente
  captureExistingLogs();
  
  // Observer de mutação para capturar logs injetados no DOM
  setupDOMLogObserver();
  
  // Monitorar logs específicos que usam console.log customizado
  interceptAICCLogs();
}

// Capturar logs que já foram exibidos no console
function captureExistingLogs() {
  try {
    // Tentativa de acessar os logs existentes via devtools
    const existingLogs = [];
    
    // Se houver logs no DOM (algumas ferramentas injetam logs visualmente)
    document.querySelectorAll('div.console-log-entry').forEach(el => {
      sendLog('info', [el.textContent]);
    });
  } catch (e) {
    console.error('Erro ao capturar logs existentes:', e);
  }
}

// Observer para monitorar adições ao DOM que podem ser logs
function setupDOMLogObserver() {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.ELEMENT_NODE) {
          const text = node.textContent || node.innerText || '';
          
          // Procurar padrão [AICCLOG] nos textos adicionados
          if (text.includes('[AICCLOG') || 
              text.includes('this.queryAgentTaskList is not a function') ||
              text.includes('ccagent.requestAgentEvent')) {
            sendLog('info', [text]);
          }
        }
      });
    });
  });
  
  // Observar todo o corpo do documento para alterações
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

// Interceptar especificamente logs do sistema AICC
function interceptAICCLogs() {
  try {
    // Criar um script para injeção usando arquivo externo
    const scriptObj = document.createElement('script');
    
    // Carregar de um arquivo em vez de usar script inline
    scriptObj.src = chrome.runtime.getURL('aicc-script.js');
    scriptObj.onload = function() {
      // Remover o script após carregar para não poluir a página
      this.remove();
    };

    // Adicionar o script ao documento
    (document.head || document.documentElement).appendChild(scriptObj);
    
    // Escutar evento disparado pelo script injetado
    document.addEventListener('aicc_log_captured', function(e) {
      try {
        sendLog('info', [e.detail.logText]);
      } catch (error) {
        console.error("Erro ao processar log AICC:", error);
      }
    });
    
    document.addEventListener('aicc_system_found', function() {
      try {
        sendLog('info', ['Sistema AICC detectado e monitorado']);
      } catch (error) {
        console.error("Erro ao reportar sistema AICC:", error);
      }
    });
    
    document.addEventListener('aicc_script_found', function(e) {
      try {
        sendLog('info', [`Script ${e.detail.script} encontrado e monitorado`]);
      } catch (error) {
        console.error("Erro ao reportar script AICC:", error);
      }
    });
  } catch (e) {
    console.error('Erro ao interceptar logs AICC:', e);
  }
}

// Inicializar a captura avançada de logs após 1 segundo para garantir que o sistema esteja carregado
setTimeout(setupAdvancedLogCapture, 1000);

// Este código deve ser o PRIMEIRO no content.js
(function setupConsoleCapture() {
  try {
    // Criar um script para injeção
    const scriptObj = document.createElement('script');
    
    // Em vez de atribuir diretamente ao textContent, vamos carregar de um arquivo
    scriptObj.src = chrome.runtime.getURL('injected-script.js');
    scriptObj.onload = function() {
      // Remover o script após carregar para não poluir a página
      this.remove();
    };

    // Adicionar o script ao documento
    (document.head || document.documentElement).appendChild(scriptObj);

    // Escutar por logs capturados
    document.addEventListener('console_log_captured', function(event) {
      try {
        const detail = event.detail;
        
        const logData = {
          type: 'console',
          logType: detail.type,
          message: detail.text,
          timestamp: detail.timestamp,
          url: window.location.href,
          rawFormat: detail.text,
          isAICCLog: detail.isAICCLog
        };
        
        // Verificar se o runtime da extensão ainda é válido antes de enviar
        if (chrome.runtime && chrome.runtime.id) {
          chrome.runtime.sendMessage(logData).catch((error) => {
            console.error("Erro ao enviar log capturado:", error);
            // Tentar armazenar localmente
            try {
              const logs = JSON.parse(localStorage.getItem('extension_pending_logs') || '[]');
              logs.push(logData);
              localStorage.setItem('extension_pending_logs', JSON.stringify(logs.slice(-100)));
            } catch (e) {
              // Falha silenciosa
            }
          });
        } else {
          // Armazenar localmente se o contexto for inválido
          try {
            const logs = JSON.parse(localStorage.getItem('extension_pending_logs') || '[]');
            logs.push(logData);
            localStorage.setItem('extension_pending_logs', JSON.stringify(logs.slice(-100)));
          } catch (e) {
            // Falha silenciosa
          }
        }
      } catch (error) {
        console.error("Erro ao processar log capturado:", error);
      }
    });

    // Escutar detecção de scripts AICC
    document.addEventListener('aicc_script_detected', function(event) {
      try {
        console.log('AICC Script detectado:', event.detail.src);
        
        const logData = {
          type: 'console',
          logType: 'info',
          message: `AICC Script detectado: ${event.detail.src}`,
          timestamp: new Date().toISOString(),
          url: window.location.href,
          isAICCLog: true
        };
        
        // Verificar se o runtime da extensão ainda é válido
        if (chrome.runtime && chrome.runtime.id) {
          chrome.runtime.sendMessage(logData).catch(() => {
            // Tentar armazenar localmente
            try {
              const logs = JSON.parse(localStorage.getItem('extension_pending_logs') || '[]');
              logs.push(logData);
              localStorage.setItem('extension_pending_logs', JSON.stringify(logs.slice(-100)));
            } catch (e) {
              // Falha silenciosa
            }
          });
        } else {
          // Armazenar localmente se o contexto for inválido
          try {
            const logs = JSON.parse(localStorage.getItem('extension_pending_logs') || '[]');
            logs.push(logData);
            localStorage.setItem('extension_pending_logs', JSON.stringify(logs.slice(-100)));
          } catch (e) {
            // Falha silenciosa
          }
        }
      } catch (error) {
        console.error("Erro ao processar detecção de script AICC:", error);
      }
    });
  } catch (error) {
    console.error("Erro ao configurar captura de console:", error);
  }
})();

// Resto do seu código content.js pode continuar aqui... 