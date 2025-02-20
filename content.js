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