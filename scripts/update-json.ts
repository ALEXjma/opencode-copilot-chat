import { createOpencode } from '@opencode-ai/sdk';
import type {
  VSCodeModelsInfo,
  ExtenedModelInfoType,
  ProvidorInfo,
} from './type';
import { file } from 'bun';
import { exists } from 'fs/promises';
import { join } from 'path';

const openCodeSessionKey = process.env.OPENCODE_API_KEY;

if (!openCodeSessionKey) {
  console.error('OPENCODE_API_KEY environment variable is not set');
  process.exit(1);
}

const openCode = await createOpencode();

openCode.client.auth.set({
  path: {
    id: 'opencode',
  },
  body: {
    type: 'api',
    key: openCodeSessionKey,
  },
});

const providors = await openCode.client.config.providers();

if (providors.error) {
  console.error(providors.error);
}

const npmPackageToApiTypeMap: Record<string, VSCodeModelsInfo['apiType']> = {
  '@ai-sdk/openai-compatible': 'chat-completions',
  '@ai-sdk/anthropic': 'messages',
};

process.on('exit', () => {
  openCode.server.close();
});

if (!providors.data || !providors.data.providers) {
  console.error('No providers found');
  process.exit(1);
}

const providorModelInfo: ProvidorInfo[] = providors.data.providers
  .map((provider) => {
    if (!provider.models) {
      console.error(`No models found for provider ${provider.name}`);
      return null;
    }
    const models = Object.entries(provider.models).map(
      ([modelId, model]: [string, ExtenedModelInfoType]) => {
        return {
          id: modelId,
          name: model.name,
          url: model.api.url,
          apiType: npmPackageToApiTypeMap[model.api.npm] || 'chat-completions',
          toolCalling: model.capabilities.toolcall,
          vision: model.capabilities.input.image,
          thinking: model.capabilities.reasoning,
          maxInputTokens: model.limit.context,
          maxOutputTokens: model.limit.output,
          ...(model.variants && Object.keys(model.variants).length > 0
            ? {
                supportsReasoningEffort: Object.keys(model.variants),
              }
            : {}),
        } as VSCodeModelsInfo;
      },
    );
    return {
      name: provider.name,
      models,
    } as ProvidorInfo;
  })
  .filter((provider) => !!provider);

const newFileJsonFormat = providorModelInfo.map((provider) => {
  return {
    name: provider.name,
    vendor: 'customendpoint',
    apiKey: 'replace_with_your_api_key',
    models: provider.models,
  };
});

const modelSettingsFileContent = JSON.stringify(newFileJsonFormat, null, 2);

await file('./model-settings.json').write(
  modelSettingsFileContent.substring(1, modelSettingsFileContent.length - 1),
);

const modelDir = './models';

if (await exists(modelDir)) {
  for (const provider of providorModelInfo) {
    const fileContent = JSON.stringify(
      {
        models: provider.models,
      },
      null,
      2,
    );
    await file(
      join(modelDir, `${provider.name.toLowerCase().replace(/ /g, '-')}.json`),
    ).write(fileContent.substring(1, fileContent.length - 1));
  }
  if (providorModelInfo.map((provider) => provider.models).flat().length > 0) {
    const fileContent = JSON.stringify(
      {
        models: providorModelInfo.map((provider) => provider.models).flat(),
      },
      null,
      2,
    );
    await file(join(modelDir, 'all.json')).write(
      fileContent.substring(1, fileContent.length - 1),
    );
  }
}

process.exit(0);
