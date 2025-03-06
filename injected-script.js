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