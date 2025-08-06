```ts
// To run this code you need to install the following dependencies:
// npm install @google/genai mime
// npm install -D @types/node

import {
  GoogleGenAI,
  Type,
} from '@google/genai';

async function main() {
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
  });
  const tools = [
    {
      functionDeclarations: [
        {
          name: 'getWeather',
          description: 'gets the weather for a requested city',
          parameters: {
            type: Type.OBJECT,
            properties: {
              city: {
                type: Type.STRING,
              },
            },
          },
        },
      ],
    }
  ];
  const config = {
    thinkingConfig: {
      thinkingBudget: -1,
    },
    tools,
  };
  const model = 'gemini-2.5-flash';
  const contents = [
    {
      role: 'user',
      parts: [
        {
          text: `今日の東京の天気は`,
        },
      ],
    },
    {
      role: 'model',
      parts: [
        {
          text: `**Obtaining Weather Information**

I'm now ready to use the \`getWeather\` tool. I've successfully extracted "東京" (Tokyo) from the user's request. My next step is to call this tool with Tokyo as the city input.


**Analyzing the User's Request**

I've determined that "東京" (Tokyo) is the city for which the user wants the weather information. Consequently, I intend to utilize the \`getWeather\` tool and will input "東京" as the city parameter. This aligns perfectly with the user's initial prompt and intended query.


`,
        },
        {
          functionCall: {
            name: `getWeather`,
            args: {"city":"東京"},
          }
        },
      ],
    },
    {
      role: 'user',
      parts: [
        {
          functionResponse: {
            name: `getWeather`,
            response: {
              output: `くもり`,
            },
          }
        },
      ],
    },
    {
      role: 'model',
      parts: [
        {
          text: `今日の東京の天気はくもりです。`,
        },
      ],
    },
    {
      role: 'user',
      parts: [
        {
          text: `INSERT_INPUT_HERE`,
        },
      ],
    },
  ];

  const response = await ai.models.generateContentStream({
    model,
    config,
    contents,
  });
  let fileIndex = 0;
  for await (const chunk of response) {
    console.log(chunk.functionCalls ? chunk.functionCalls[0] : chunk.text);
  }
}

main();
```