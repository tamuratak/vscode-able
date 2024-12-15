import {
    createByModelName
} from '@microsoft/tiktokenizer'

void createByModelName('gpt-4o').then(tokenizer => console.log(tokenizer.encode('Hello, world!')))
