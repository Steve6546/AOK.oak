// Docker-based code execution service
// This module provides secure code execution in isolated Docker containers

import { exec } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';

const execPromise = promisify(exec);

interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
  memoryUsage?: number;
}

interface ExecutionOptions {
  timeout?: number; // in milliseconds
  memoryLimit?: string; // e.g., '256m'
  networkDisabled?: boolean;
  language: string;
}

const TEMP_DIR = '/tmp/code-execution';
const DEFAULT_TIMEOUT = 10000; // 10 seconds
const DEFAULT_MEMORY = '256m';

// Supported languages and their Docker images
const LANGUAGE_IMAGES = {
  javascript: 'node:18-alpine',
  typescript: 'node:18-alpine',
  python: 'python:3.10-alpine',
  java: 'openjdk:17-alpine',
  go: 'golang:1.19-alpine',
  rust: 'rust:1.67-alpine',
  ruby: 'ruby:3.2-alpine',
  php: 'php:8.2-alpine',
  csharp: 'mcr.microsoft.com/dotnet/sdk:7.0-alpine'
};

// File extensions for each language
const LANGUAGE_EXTENSIONS = {
  javascript: 'js',
  typescript: 'ts',
  python: 'py',
  java: 'java',
  go: 'go',
  rust: 'rs',
  ruby: 'rb',
  php: 'php',
  csharp: 'cs'
};

// Commands to execute code for each language
const EXECUTION_COMMANDS = {
  javascript: 'node',
  typescript: 'ts-node',
  python: 'python',
  java: 'java',
  go: 'go run',
  rust: 'rustc -o /tmp/output && /tmp/output',
  ruby: 'ruby',
  php: 'php',
  csharp: 'dotnet run'
};

export class DockerExecutor {
  private async createTempDir(sessionId: string): Promise<string> {
    const dirPath = path.join(TEMP_DIR, sessionId);
    await fs.mkdir(dirPath, { recursive: true });
    return dirPath;
  }

  private async writeCodeToFile(code: string, dirPath: string, language: string): Promise<string> {
    const extension = LANGUAGE_EXTENSIONS[language] || 'txt';
    const filename = `code.${extension}`;
    const filePath = path.join(dirPath, filename);
    await fs.writeFile(filePath, code);
    return filePath;
  }

  private async cleanupTempDir(dirPath: string): Promise<void> {
    try {
      await fs.rm(dirPath, { recursive: true, force: true });
    } catch (error) {
      console.error(`Error cleaning up temp directory: ${error.message}`);
    }
  }

  private getDockerCommand(
    filePath: string, 
    dirPath: string, 
    language: string, 
    options: ExecutionOptions
  ): string {
    const image = LANGUAGE_IMAGES[language] || 'alpine:latest';
    const command = EXECUTION_COMMANDS[language] || 'sh';
    const filename = path.basename(filePath);
    
    const memoryLimit = options.memoryLimit || DEFAULT_MEMORY;
    const networkFlag = options.networkDisabled ? '--network=none' : '';
    
    return `docker run --rm ${networkFlag} -m ${memoryLimit} -v ${dirPath}:/code -w /code ${image} ${command} ${filename}`;
  }

  public async executeCode(
    code: string, 
    options: ExecutionOptions
  ): Promise<ExecutionResult> {
    const sessionId = uuidv4();
    const dirPath = await this.createTempDir(sessionId);
    const filePath = await this.writeCodeToFile(code, dirPath, options.language);
    
    const dockerCommand = this.getDockerCommand(filePath, dirPath, options.language, options);
    const timeout = options.timeout || DEFAULT_TIMEOUT;
    
    const startTime = Date.now();
    let result: ExecutionResult;
    
    try {
      const { stdout, stderr } = await execPromise(dockerCommand, { timeout });
      const endTime = Date.now();
      
      result = {
        stdout,
        stderr,
        exitCode: 0,
        executionTime: endTime - startTime
      };
    } catch (error) {
      const endTime = Date.now();
      
      result = {
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
        exitCode: error.code || 1,
        executionTime: endTime - startTime
      };
    } finally {
      await this.cleanupTempDir(dirPath);
    }
    
    return result;
  }

  // Method to check if Docker is available
  public async checkDockerAvailability(): Promise<boolean> {
    try {
      await execPromise('docker --version');
      return true;
    } catch (error) {
      console.error('Docker is not available:', error.message);
      return false;
    }
  }
}

export default new DockerExecutor();
