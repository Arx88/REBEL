#!/usr/bin/env node

/**
 * REBEL Multi-Agent Orchestrator - Cross-Platform Setup
 * =====================================================
 * 
 * Usage: node setup.js [options]
 * 
 * This script provides a cross-platform installation experience
 * that works on Windows, macOS, and Linux without bash dependencies.
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
  minNodeVersion: 18,
  requiredSpaceMB: 500,
  backendPort: 3001,
  frontendPort: 5173,
  colors: {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
  }
};

const INSTALL_DIR = __dirname;
const BACKEND_DIR = path.join(INSTALL_DIR, 'backend');
const FRONTEND_DIR = path.join(INSTALL_DIR, '..', 'app');

// ============================================
// UTILITY FUNCTIONS
// ============================================

const c = CONFIG.colors;

const log = {
  banner: () => {
    console.log(`
${c.cyan}${c.bright}
  ____  _____ ____  _____ _     
 |  _ \\| ____| __ )| ____| |    
 | |_) |  _| |  _ \\|  _| | |    
 |  _ <| |___| |_) | |___| |___ 
 |_| \\_\\_____|____/|_____|_____|

${c.white} Multi-Agent Orchestrator${c.reset}
${c.cyan} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}
`);
  },
  
  step: (num, total, msg) => {
    console.log(`\n${c.blue}${c.bright}[${num}/${total}]${c.reset} ${msg}`);
    console.log(`${c.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`);
  },
  
  success: (msg) => console.log(`  ${c.green}[OK]${c.reset} ${msg}`),
  error: (msg) => console.log(`  ${c.red}[X]${c.reset} ${msg}`),
  warn: (msg) => console.log(`  ${c.yellow}[!]${c.reset} ${msg}`),
  info: (msg) => console.log(`  ${c.cyan}-->${c.reset} ${msg}`),
};

function exec(cmd, options = {}) {
  try {
    return execSync(cmd, { 
      encoding: 'utf-8', 
      stdio: options.silent ? 'pipe' : 'inherit',
      ...options 
    });
  } catch (e) {
    if (!options.ignoreError) throw e;
    return null;
  }
}

function commandExists(cmd) {
  try {
    if (process.platform === 'win32') {
      execSync(`where ${cmd}`, { stdio: 'pipe' });
    } else {
      execSync(`which ${cmd}`, { stdio: 'pipe' });
    }
    return true;
  } catch {
    return false;
  }
}

function getNodeVersion() {
  const version = process.version.replace('v', '');
  return parseInt(version.split('.')[0], 10);
}

async function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

// ============================================
// CHECKS
// ============================================

const checks = {
  os: () => {
    const platform = process.platform;
    const arch = process.arch;
    
    const osNames = {
      darwin: 'macOS',
      win32: 'Windows',
      linux: 'Linux',
    };
    
    log.success(`${osNames[platform] || platform} (${arch})`);
    return { platform, arch };
  },
  
  node: () => {
    const version = getNodeVersion();
    
    if (version < CONFIG.minNodeVersion) {
      log.error(`Node.js v${version} es muy antiguo (minimo: v${CONFIG.minNodeVersion})`);
      log.info(`Actualiza desde: https://nodejs.org`);
      process.exit(1);
    }
    
    log.success(`Node.js ${process.version}`);
    
    // Check npm
    try {
      const npmVersion = execSync('npm -v', { encoding: 'utf-8' }).trim();
      log.success(`npm v${npmVersion}`);
    } catch {
      log.error('npm no encontrado');
      process.exit(1);
    }
  },
  
  cliTools: async () => {
    const result = { gemini: false, qwen: false };
    
    if (commandExists('gemini')) {
      result.gemini = true;
      log.success('Gemini CLI encontrado');
    } else {
      log.warn('Gemini CLI no encontrado');
      log.info('Instalar: npm install -g @google/generative-ai-cli');
    }
    
    if (commandExists('qwen')) {
      result.qwen = true;
      log.success('Qwen CLI encontrado');
    } else {
      log.warn('Qwen CLI no encontrado');
      log.info('Instalar segun documentacion de Qwen');
    }
    
    if (!result.gemini && !result.qwen) {
      console.log('');
      log.warn('Ningun CLI de agente encontrado');
      log.info('El sistema funcionara en modo limitado');
      
      const answer = await prompt('\n  Continuar de todos modos? [y/N] ');
      if (answer.toLowerCase() !== 'y') {
        process.exit(1);
      }
    }
    
    return result;
  },
};

// ============================================
// INSTALLATION
// ============================================

const install = {
  backend: () => {
    process.chdir(BACKEND_DIR);
    
    // Install dependencies
    log.info('Instalando dependencias...');
    exec('npm install', { silent: true });
    log.success('Dependencias instaladas');
    
    // Create .env if not exists
    const envPath = path.join(BACKEND_DIR, '.env');
    if (!fs.existsSync(envPath)) {
      log.info('Creando configuracion...');
      
      const envContent = `# REBEL Multi-Agent Orchestrator Configuration
# =============================================

# Server
PORT=3001
HOST=localhost

# CLI Paths
GEMINI_CLI_PATH=gemini
QWEN_CLI_PATH=qwen

# Agent Pool
MAX_GEMINI_AGENTS=10
MAX_QWEN_AGENTS=10

# Database
DB_PATH=./data/orchestrator.db

# Features
ENABLE_RATE_LIMIT_FALLBACK=true
ENABLE_PLAN_REFINEMENT=true
MAX_REFINEMENT_ITERATIONS=3

# Logging
LOG_LEVEL=info
`;
      
      fs.writeFileSync(envPath, envContent);
      log.success('Archivo .env creado');
    } else {
      log.success('Archivo .env existente preservado');
    }
    
    // Create data directory
    const dataDir = path.join(BACKEND_DIR, 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    log.success('Directorio de datos listo');
    
    // Build TypeScript
    log.info('Compilando TypeScript...');
    try {
      exec('npm run build', { silent: true, ignoreError: true });
      log.success('Backend compilado');
    } catch {
      log.warn('Build opcional fallido, continuando...');
    }
    
    process.chdir(INSTALL_DIR);
  },
  
  frontend: () => {
    if (!fs.existsSync(FRONTEND_DIR)) {
      log.warn('Directorio frontend no encontrado');
      log.info('Saltando instalacion del frontend');
      return;
    }
    
    process.chdir(FRONTEND_DIR);
    
    log.info('Instalando dependencias...');
    exec('npm install', { silent: true });
    log.success('Dependencias instaladas');
    
    process.chdir(INSTALL_DIR);
  },
  
  scripts: () => {
    // Make shell scripts executable on Unix
    if (process.platform !== 'win32') {
      const scripts = ['start.sh', 'install.sh', 'rebel'];
      scripts.forEach(script => {
        const scriptPath = path.join(INSTALL_DIR, script);
        if (fs.existsSync(scriptPath)) {
          fs.chmodSync(scriptPath, '755');
        }
      });
    }
    
    log.success('Scripts de inicio configurados');
    log.success('CLI helper disponible');
  },
};

// ============================================
// COMPLETION
// ============================================

function showCompletion(cliStatus) {
  console.log(`
${c.green}${c.bright}
  ============================================
       INSTALACION COMPLETADA
  ============================================
${c.reset}

  ${c.white}Para iniciar REBEL:${c.reset}

    ${c.cyan}cd multi-agent-orchestrator${c.reset}
    ${c.cyan}./start.sh${c.reset}  ${c.white}(Unix)${c.reset}
    ${c.cyan}start.bat${c.reset}   ${c.white}(Windows)${c.reset}

  ${c.white}O usa el CLI helper:${c.reset}

    ${c.cyan}./rebel start${c.reset}     # Iniciar todo
    ${c.cyan}./rebel status${c.reset}    # Ver estado
    ${c.cyan}./rebel agents${c.reset}    # Ver agentes
    ${c.cyan}./rebel help${c.reset}      # Mas comandos
`);

  if (!cliStatus.gemini || !cliStatus.qwen) {
    console.log(`  ${c.yellow}Recordatorio:${c.reset}`);
    if (!cliStatus.gemini) {
      console.log(`    - Instala Gemini CLI para funcionalidad completa`);
    }
    if (!cliStatus.qwen) {
      console.log(`    - Instala Qwen CLI para funcionalidad completa`);
    }
    console.log('');
  }
}

// ============================================
// MAIN
// ============================================

async function main() {
  const TOTAL_STEPS = 6;
  
  log.banner();
  console.log(`${c.white}Iniciando instalacion automatica...${c.reset}`);
  
  // Step 1: Check OS
  log.step(1, TOTAL_STEPS, 'Detectando Sistema Operativo');
  checks.os();
  
  // Step 2: Check Node
  log.step(2, TOTAL_STEPS, 'Verificando Node.js');
  checks.node();
  
  // Step 3: Check CLI Tools
  log.step(3, TOTAL_STEPS, 'Verificando CLI Tools');
  const cliStatus = await checks.cliTools();
  
  // Step 4: Install Backend
  log.step(4, TOTAL_STEPS, 'Instalando Backend');
  install.backend();
  
  // Step 5: Install Frontend
  log.step(5, TOTAL_STEPS, 'Instalando Frontend');
  install.frontend();
  
  // Step 6: Setup Scripts
  log.step(6, TOTAL_STEPS, 'Configurando Scripts');
  install.scripts();
  
  // Done
  showCompletion(cliStatus);
}

// Run
main().catch(err => {
  console.error(`\n${c.red}Error:${c.reset}`, err.message);
  process.exit(1);
});
