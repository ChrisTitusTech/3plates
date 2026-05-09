import { initClient } from '@ts-rest/core';

import { appContract } from '@3plates/contract';

const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export const apiClient = initClient(appContract, {
  baseUrl: apiBaseUrl,
});
