// ──────────────────────────────────────────────
// LLM Provider Registry — Multi-provider inference orchestration
// ──────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export type LLMProviderType = 'openrouter' | 'cerebras' | 'anthropic' | 'openai';

export interface ProviderConfig {
  provider: LLMProviderType;
  model: string;
  apiKey: string;
  baseURL?: string;
}

@Injectable()
export class LLMProviderRegistry {
  private readonly logger = new Logger(LLMProviderRegistry.name);
  private clients = new Map<string, OpenAI>(); // Using OpenAI SDK as a universal client since Cerebras and OpenRouter are OpenAI-compatible

  constructor(private readonly config: ConfigService) {}

  /**
   * Get an OpenAI-compatible client for a specific provider config.
   * Caches clients by API key to avoid recreating them constantly.
   */
  getClient(config: ProviderConfig): { client: OpenAI; model: string } {
    const key = `${config.provider}:${config.apiKey}`;
    
    if (!this.clients.has(key)) {
      let clientConfig: any = { apiKey: config.apiKey };

      switch (config.provider) {
        case 'openrouter':
          clientConfig.baseURL = config.baseURL || 'https://openrouter.ai/api/v1';
          break;
        case 'cerebras':
          clientConfig.baseURL = config.baseURL || 'https://api.cerebras.ai/v1';
          break;
        case 'openai':
          // Default OpenAI base URL
          break;
        case 'anthropic':
          // Anthropic requires a different SDK normally, but for MVP we might route it through OpenRouter
          // or assume an OpenAI compatibility layer proxy if used.
          // In a real multi-SDK setup, we'd return a custom adapter interface.
          throw new Error('Anthropic direct SDK not implemented. Please use OpenRouter to access Claude models.');
        default:
          throw new Error(`Unsupported provider: ${config.provider}`);
      }

      const client = new OpenAI(clientConfig);
      this.clients.set(key, client);
      this.logger.log(`Initialized new client for provider: ${config.provider}`);
    }

    return { client: this.clients.get(key)!, model: config.model };
  }

  /**
   * Get the default system provider (e.g., OpenRouter with the key from .env)
   */
  getDefaultProvider(): ProviderConfig {
    return {
      provider: 'openrouter',
      apiKey: this.config.get<string>('OPEN_ROUTER_KEY') || '',
      baseURL: this.config.get<string>('OPEN_ROUTER_API_URL'),
      model: this.config.get<string>('OPEN_ROUTER_MODEL') || 'openai/gpt-4o',
    };
  }
}
