(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.providerFormats = value;
})(globalThis, () => [
  { id: 'openai-chat-completions', name: 'OpenAI Chat Completions', baseUrl: 'https://api.openai.com/v1' },
  { id: 'openai-responses', name: 'OpenAI Responses', baseUrl: 'https://api.openai.com/v1' },
  { id: 'anthropic-messages', name: 'Anthropic Messages', baseUrl: 'https://api.anthropic.com/v1' },
  { id: 'gemini', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
]);
