(function() {
  // Buscar o objeto console original
  const originalConsoleLog = console.log;
  
  // Substituir console.log para capturar todos os logs
  console.log = function() {
    // Chamar função original
    originalConsoleLog.apply(console, arguments);
    
    // Verificar se é um log AICC
    const args = Array.from(arguments);
    const logText = args.join(' ');
    
    if (logText.includes('[AICCLOG') || 
        logText.includes('this.queryAgentTaskList') ||
        logText.includes('ccagent.requestAgentEvent')) {
      // Dispara um evento customizado que o content script pode capturar
      document.dispatchEvent(new CustomEvent('aicc_log_captured', {
        detail: { logText, timestamp: new Date().toISOString() }
      }));
    }
  };
  
  // Procurar por variáveis específicas do sistema AICC
  window.addEventListener('load', function() {
    // Se encontrarmos componentes específicos do AICC, podemos adicionar interceptores
    setTimeout(() => {
      // Verificar se existe algum objeto global do AICC
      if (window.AICC || window.aicc || window.AIAgent) {
        document.dispatchEvent(new CustomEvent('aicc_system_found'));
      }
      
      // Verificar funções específicas do index-BN_Wr1AE.js
      try {
        const scripts = document.querySelectorAll('script[src*="index-BN_Wr1AE.js"]');
        if (scripts.length > 0) {
          document.dispatchEvent(new CustomEvent('aicc_script_found', {
            detail: { script: 'index-BN_Wr1AE.js' }
          }));
        }
      } catch(e) {
        console.error('Erro ao verificar scripts:', e);
      }
    }, 2000);
  });
})(); 