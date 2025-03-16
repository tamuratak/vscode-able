### File: node_modules/@vscode/prompt-tsx/dist/base/htmlTracer.d.ts

Content:
import { IElementEpochData, ITraceData, ITraceEpoch, ITracer } from './tracer';
/**
 * Handler that can trace rendering internals into an HTML summary.
 */
export declare class HTMLTracer implements ITracer {
    private traceData?;
    private readonly epochs;
    addRenderEpoch(epoch: ITraceEpoch): void;
    includeInEpoch(data: IElementEpochData): void;
    didMaterializeTree(traceData: ITraceData): void;
    /**
     * Returns HTML to trace the output. Note that is starts a server which is
     * used for client interaction to resize the prompt and its `address` should
     * be displayed or opened as a link in a browser.
     *
     * The server runs until it is disposed.
     */
    serveHTML(): Promise<IHTMLServer>;
    /**
     * Gets an HTML router for a server at the URL. URL is the form `http://127.0.0.1:1234`.
     */
    serveRouter(url: string): IHTMLRouter;
}
export interface IHTMLRouter {
    address: string;
    route(httpIncomingMessage: unknown, httpOutgoingMessage: unknown): boolean;
}
export interface IHTMLServer {
    address: string;
    getHTML(): Promise<string>;
    dispose(): void;
}

### File: node_modules/@vscode/prompt-tsx/dist/base/htmlTracerTypes.d.ts

Content:
import { ITraceEpoch } from './tracer';
export type HTMLTraceEpoch = ITraceEpoch;
export interface IHTMLTraceRenderData {
    container: ITraceMaterializedContainer;
    removed: number;
    budget: number;
}
export type ITraceMaterializedNode = ITraceMaterializedContainer | ITraceMaterializedChatMessage | ITraceMaterializedChatMessageTextChunk;
export declare const enum TraceMaterializedNodeType {
    Container = 0,
    ChatMessage = 1,
    TextChunk = 2
}
export interface IMaterializedMetadata {
    name: string;
    value: string;
}
export interface ITraceMaterializedCommon {
    priority: number;
    tokens: number;
    metadata: IMaterializedMetadata[];
}
export interface ITraceMaterializedContainer extends ITraceMaterializedCommon {
    type: TraceMaterializedNodeType.Container;
    id: number;
    name: string | undefined;
    children: ITraceMaterializedNode[];
}
export interface ITraceMaterializedChatMessage extends ITraceMaterializedCommon {
    type: TraceMaterializedNodeType.ChatMessage;
    id: number;
    role: string;
    name: string | undefined;
    priority: number;
    text: string;
    tokens: number;
    children: ITraceMaterializedNode[];
}
export interface ITraceMaterializedChatMessageTextChunk extends ITraceMaterializedCommon {
    type: TraceMaterializedNodeType.TextChunk;
    value: string;
    priority: number;
    tokens: number;
}

### File: node_modules/@vscode/prompt-tsx/dist/base/index.d.ts

Content:
import type { CancellationToken, ChatResponsePart, LanguageModelChat, Progress, LanguageModelChatMessage } from 'vscode';
import { PromptElementJSON } from './jsonTypes';
import { ChatMessage } from './openai';
import { MetadataMap } from './promptRenderer';
import { PromptReference } from './results';
import { ITokenizer } from './tokenizer/tokenizer';
import { BasePromptElementProps, IChatEndpointInfo, PromptElementCtor } from './types';
import { ChatDocumentContext } from './vscodeTypes.d';
export * from './htmlTracer';
export * as JSONTree from './jsonTypes';
export { AssistantChatMessage, ChatMessage, ChatRole, FunctionChatMessage, SystemChatMessage, ToolChatMessage, UserChatMessage, } from './openai';
export * from './results';
export { ITokenizer } from './tokenizer/tokenizer';
export * from './tracer';
export * from './tsx-globals';
export * from './types';
export { AssistantMessage, Chunk, FunctionMessage, LegacyPrioritization, PrioritizedList, PrioritizedListProps, SystemMessage, TextChunk, TextChunkProps, ToolCall, ToolMessage, UserMessage, ToolResult } from './promptElements';
export { PromptElement } from './promptElement';
export { MetadataMap, PromptRenderer, QueueItem, RenderPromptResult } from './promptRenderer';
/**
 * Renders a prompt element and returns the result.
 *
 * @template P - The type of the prompt element props.
 * @param ctor - The constructor of the prompt element.
 * @param props - The props for the prompt element.
 * @param endpoint - The chat endpoint information.
 * @param progress - The progress object for reporting progress of the chat response.
 * @param token - The cancellation token for cancelling the operation.
 * @param tokenizer - The tokenizer for tokenizing the chat response.
 * @param mode - The mode to render the chat messages in.
 * @returns A promise that resolves to an object containing the rendered {@link LanguageModelChatMessage chat messages}, token count, metadatas, used context, and references.
 */
export declare function renderPrompt<P extends BasePromptElementProps>(ctor: PromptElementCtor<P, any>, props: P, endpoint: IChatEndpointInfo, tokenizerMetadata: ITokenizer | LanguageModelChat, progress?: Progress<ChatResponsePart>, token?: CancellationToken, mode?: 'vscode'): Promise<{
    messages: LanguageModelChatMessage[];
    tokenCount: number;
    /** @deprecated use {@link metadata} */
    metadatas: MetadataMap;
    metadata: MetadataMap;
    usedContext: ChatDocumentContext[];
    references: PromptReference[];
}>;
/**
 * Renders a prompt element and returns the result.
 *
 * @template P - The type of the prompt element props.
 * @param ctor - The constructor of the prompt element.
 * @param props - The props for the prompt element.
 * @param endpoint - The chat endpoint information.
 * @param progress - The progress object for reporting progress of the chat response.
 * @param token - The cancellation token for cancelling the operation.
 * @param tokenizer - The tokenizer for tokenizing the chat response.
 * @param mode - The mode to render the chat messages in.
 * @returns A promise that resolves to an object containing the rendered {@link ChatMessage chat messages}, token count, metadatas, used context, and references.
 */
export declare function renderPrompt<P extends BasePromptElementProps>(ctor: PromptElementCtor<P, any>, props: P, endpoint: IChatEndpointInfo, tokenizerMetadata: ITokenizer, progress?: Progress<ChatResponsePart>, token?: CancellationToken, mode?: 'none'): Promise<{
    messages: ChatMessage[];
    tokenCount: number;
    /** @deprecated use {@link metadata} */
    metadatas: MetadataMap;
    metadata: MetadataMap;
    usedContext: ChatDocumentContext[];
    references: PromptReference[];
}>;
/**
 * Content type of the return value from {@link renderElementJSON}.
 * When responding to a tool invocation, the tool should set this as the
 * content type in the returned data:
 *
 * ```ts
 * import { contentType } from '@vscode/prompt-tsx';
 *
 * async function doToolInvocation(): vscode.LanguageModelToolResult {
 *   return {
 *     [contentType]: await renderElementJSON(...),
 *     toString: () => '...',
 *   };
 * }
 * ```
 */
export declare const contentType = "application/vnd.codechat.prompt+json.1";
/**
 * Renders a prompt element to a serializable state. This type be returned in
 * tools results and reused in subsequent render calls via the `<Tool />`
 * element.
 *
 * In this mode, message chunks are not pruned from the tree; budget
 * information is used only to hint to the elements how many tokens they should
 * consume when rendered.
 *
 * @template P - The type of the prompt element props.
 * @param ctor - The constructor of the prompt element.
 * @param props - The props for the prompt element.
 * @param budgetInformation - Information about the token budget.
 * `vscode.LanguageModelToolInvocationOptions` is assignable to this object.
 * @param token - The cancellation token for cancelling the operation.
 * @returns A promise that resolves to an object containing the serialized data.
 */
export declare function renderElementJSON<P extends BasePromptElementProps>(ctor: PromptElementCtor<P, any>, props: P, budgetInformation: {
    tokenBudget: number;
    countTokens(text: string, token?: CancellationToken): Thenable<number>;
} | undefined, token?: CancellationToken): Promise<PromptElementJSON>;
/**
 * Converts an array of {@link ChatMessage} objects to an array of corresponding {@link LanguageModelChatMessage VS Code chat messages}.
 * @param messages - The array of {@link ChatMessage} objects to convert.
 * @returns An array of {@link LanguageModelChatMessage VS Code chat messages}.
 */
export declare function toVsCodeChatMessages(messages: ChatMessage[]): any[];

### File: node_modules/@vscode/prompt-tsx/dist/base/jsonTypes.d.ts

Content:
import type { Range } from 'vscode';
import { ChatResponseReferencePartStatusKind } from './results';
import { UriComponents } from './util/vs/common/uri';
export declare const enum PromptNodeType {
    Piece = 1,
    Text = 2
}
export interface TextJSON {
    type: PromptNodeType.Text;
    text: string;
    priority: number | undefined;
    references: PromptReferenceJSON[] | undefined;
    lineBreakBefore: boolean | undefined;
}
/**
 * Constructor kind of the node represented by {@link PieceJSON}. This is
 * less descriptive than the actual constructor, as we only care to preserve
 * the element data that the renderer cares about.
 */
export declare const enum PieceCtorKind {
    BaseChatMessage = 1,
    Other = 2
}
export interface PieceJSON {
    type: PromptNodeType.Piece;
    ctor: PieceCtorKind;
    priority: number | undefined;
    children: PromptNodeJSON[];
    references: PromptReferenceJSON[] | undefined;
    /** Only filled in for known `PieceCtorKind`s where props are necessary. */
    props?: Record<string, unknown>;
}
export type PromptNodeJSON = PieceJSON | TextJSON;
export type UriOrLocationJSON = UriComponents | {
    uri: UriComponents;
    range: Range;
};
export interface PromptReferenceJSON {
    anchor: UriOrLocationJSON | {
        variableName: string;
        value?: UriOrLocationJSON;
    };
    iconPath?: UriComponents | {
        id: string;
    } | {
        light: UriComponents;
        dark: UriComponents;
    };
    options?: {
        status?: {
            description: string;
            kind: ChatResponseReferencePartStatusKind;
        };
    };
}
export interface PromptElementJSON {
    node: PieceJSON;
}
/** Iterates over each {@link PromptNodeJSON} in the tree. */
export declare function forEachNode(node: PromptNodeJSON, fn: (node: PromptNodeJSON) => void): void;

### File: node_modules/@vscode/prompt-tsx/dist/base/materialized.d.ts

Content:
import { ChatMessage, ChatMessageToolCall, ChatRole } from './openai';
import { PromptMetadata } from './results';
import { ITokenizer } from './tokenizer/tokenizer';
export interface IMaterializedNode {
    /**
     * Gets the maximum number of tokens this message can contain. This is
     * calculated by summing the token counts of all individual messages, which
     * may be larger than the real count due to merging of sibling tokens.
     */
    upperBoundTokenCount(tokenizer: ITokenizer): Promise<number>;
    /**
     * Gets the precise number of tokens this message contains.
     */
    tokenCount(tokenizer: ITokenizer): Promise<number>;
}
export type MaterializedNode = MaterializedContainer | MaterializedChatMessage | MaterializedChatMessageTextChunk;
export declare const enum ContainerFlags {
    /** It's a {@link LegacyPrioritization} instance */
    IsLegacyPrioritization = 1,
    /** It's a {@link Chunk} instance */
    IsChunk = 2,
    /** Priority is passed to children. */
    PassPriority = 4
}
export declare class MaterializedContainer implements IMaterializedNode {
    readonly id: number;
    readonly name: string | undefined;
    readonly priority: number;
    readonly children: MaterializedNode[];
    readonly metadata: PromptMetadata[];
    readonly flags: number;
    constructor(id: number, name: string | undefined, priority: number, children: MaterializedNode[], metadata: PromptMetadata[], flags: number);
    has(flag: ContainerFlags): boolean;
    /** @inheritdoc */
    tokenCount(tokenizer: ITokenizer): Promise<number>;
    /** @inheritdoc */
    upperBoundTokenCount(tokenizer: ITokenizer): Promise<number>;
    /**
     * Replaces a node in the tree with the given one, by its ID.
     */
    replaceNode(nodeId: number, withNode: MaterializedNode): MaterializedNode | undefined;
    /**
     * Gets all metadata the container holds.
     */
    allMetadata(): Generator<PromptMetadata>;
    /**
     * Finds a node in the tree by ID.
     */
    findById(nodeId: number): MaterializedContainer | MaterializedChatMessage | undefined;
    /**
     * Gets the chat messages the container holds.
     */
    toChatMessages(): Generator<ChatMessage>;
    /** Removes the node in the tree with the lowest priority. */
    removeLowestPriorityChild(): void;
}
export declare const enum LineBreakBefore {
    None = 0,
    Always = 1,
    IfNotTextSibling = 2
}
/** A chunk of text in a {@link MaterializedChatMessage} */
export declare class MaterializedChatMessageTextChunk {
    readonly text: string;
    readonly priority: number;
    readonly metadata: PromptMetadata[];
    readonly lineBreakBefore: LineBreakBefore;
    constructor(text: string, priority: number, metadata: PromptMetadata[] | undefined, lineBreakBefore: LineBreakBefore);
    upperBoundTokenCount(tokenizer: ITokenizer): Promise<number>;
    private readonly _upperBound;
}
export declare class MaterializedChatMessage implements IMaterializedNode {
    readonly id: number;
    readonly role: ChatRole;
    readonly name: string | undefined;
    readonly toolCalls: ChatMessageToolCall[] | undefined;
    readonly toolCallId: string | undefined;
    readonly priority: number;
    readonly metadata: PromptMetadata[];
    readonly children: MaterializedNode[];
    constructor(id: number, role: ChatRole, name: string | undefined, toolCalls: ChatMessageToolCall[] | undefined, toolCallId: string | undefined, priority: number, metadata: PromptMetadata[], children: MaterializedNode[]);
    /** @inheritdoc */
    tokenCount(tokenizer: ITokenizer): Promise<number>;
    /** @inheritdoc */
    upperBoundTokenCount(tokenizer: ITokenizer): Promise<number>;
    /** Gets the text this message contains */
    get text(): string;
    /** Gets whether the message is empty */
    get isEmpty(): boolean;
    /**
     * Replaces a node in the tree with the given one, by its ID.
     */
    replaceNode(nodeId: number, withNode: MaterializedNode): MaterializedNode | undefined;
    /** Remove the lowest priority chunk among this message's children. */
    removeLowestPriorityChild(): void;
    onChunksChange(): void;
    /**
     * Finds a node in the tree by ID.
     */
    findById(nodeId: number): MaterializedContainer | MaterializedChatMessage | undefined;
    private readonly _tokenCount;
    private readonly _upperBound;
    private readonly _baseMessageTokenCount;
    private readonly _text;
    toChatMessage(): ChatMessage;
}

### File: node_modules/@vscode/prompt-tsx/dist/base/once.d.ts

Content:
export declare function once<T extends (...args: any[]) => any>(fn: T): T & {
    clear: () => void;
};

### File: node_modules/@vscode/prompt-tsx/dist/base/openai.d.ts

Content:
/**
 * An OpenAI Chat Completion message.
 *
 * Reference: https://platform.openai.com/docs/api-reference/chat/create
 */
export type ChatMessage = AssistantChatMessage | SystemChatMessage | UserChatMessage | ToolChatMessage | FunctionChatMessage;
export interface SystemChatMessage {
    role: ChatRole.System;
    /**
     * The content of the chat message.
     */
    content: string;
    /**
     * An optional name for the participant. Provides the model information to differentiate between participants of the same role.
     */
    name?: string;
}
export interface UserChatMessage {
    role: ChatRole.User;
    /**
     * The content of the chat message.
     */
    content: string;
    /**
     * An optional name for the participant. Provides the model information to differentiate between participants of the same role.
     */
    name?: string;
}
export interface ChatMessageToolCall {
    /**
     * The ID of the tool call.
     */
    id: string;
    /**
     * The function that the model called.
     */
    function: ChatMessageFunction;
    /**
     * The type of the tool. Currently, only `function` is supported.
     */
    type: 'function';
}
export interface AssistantChatMessage {
    role: ChatRole.Assistant;
    /**
     * The content of the chat message.
     */
    content: string;
    /**
     * An optional name for the participant. Provides the model information to differentiate between participants of the same role.
     */
    name?: string;
    /**
     * The tool calls generated by the model.
     */
    tool_calls?: Array<ChatMessageToolCall>;
}
export interface ToolChatMessage {
    role: ChatRole.Tool;
    /**
     * Tool call that this message is responding to.
     */
    tool_call_id?: string;
    /**
     * The content of the chat message.
     */
    content: string;
}
/**
 * @deprecated Use {@link ToolChatMessage} instead.
 */
export interface FunctionChatMessage {
    role: ChatRole.Function;
    /**
     * The content of the chat message.
     */
    content: string;
    /**
     * The name of the function that was called
     */
    name: string;
}
/**
 * The function that the model called.
 */
export interface ChatMessageFunction {
    /**
     * The arguments to call the function with, as generated by the model in JSON
     * format. Note that the model does not always generate valid JSON, and may
     * hallucinate parameters not defined by your function schema. Validate the
     * arguments in your code before calling your function.
     */
    arguments: string;
    /**
     * The name of the function to call.
     */
    name: string;
}
/**
 * The role of a message in an OpenAI completions request.
 */
export declare enum ChatRole {
    System = "system",
    User = "user",
    Assistant = "assistant",
    Function = "function",
    Tool = "tool"
}
/**
 * BaseTokensPerCompletion is the minimum tokens for a completion request.
 * Replies are primed with <|im_start|>assistant<|message|>, so these tokens represent the
 * special token and the role name.
 */
export declare const BaseTokensPerCompletion = 3;
export declare const BaseTokensPerMessage = 3;
export declare const BaseTokensPerName = 1;

### File: node_modules/@vscode/prompt-tsx/dist/base/promptElement.d.ts

Content:
import type { CancellationToken, Progress } from 'vscode';
import './tsx';
import { BasePromptElementProps, PromptElementProps, PromptPiece, PromptSizing } from './types';
import { ChatResponsePart } from './vscodeTypes';
/**
 * `PromptElement` represents a single element of a prompt.
 * A prompt element can be rendered by the {@link PromptRenderer} to produce {@link ChatMessage} chat messages.
 *
 * @remarks Newlines are not preserved in string literals when rendered, and must be explicitly declared with the builtin `<br />` attribute.
 *
 * @template P - The type of the properties for the prompt element. It extends `BasePromptElementProps`.
 * @template S - The type of the state for the prompt element. It defaults to `void`.
 *
 * @property props - The properties of the prompt element.
 * @property priority - The priority of the prompt element. If not provided, defaults to 0.
 *
 * @method prepare - Optionally prepares asynchronous state before the prompt element is rendered.
 * @method render - Renders the prompt element. This method is abstract and must be implemented by subclasses.
 */
export declare abstract class PromptElement<P extends BasePromptElementProps = BasePromptElementProps, S = void> {
    readonly props: PromptElementProps<P>;
    get priority(): number;
    get insertLineBreakBefore(): boolean;
    constructor(props: PromptElementProps<P>);
    /**
     * Optionally prepare asynchronous state before the prompt element is rendered.
     * @param progress - Optionally report progress to the user for long-running state preparation.
     * @param token - A cancellation token that can be used to signal cancellation to the prompt element.
     *
     * @returns A promise that resolves to the prompt element's state.
     */
    prepare?(sizing: PromptSizing, progress?: Progress<ChatResponsePart>, token?: CancellationToken): Promise<S>;
    /**
     * Renders the prompt element.
     *
     * @param state - The state of the prompt element.
     * @param sizing - The sizing information for the prompt.
     * @param progress - Optionally report progress to the user for long-running state preparation.
     * @param token - A cancellation token that can be used to signal cancellation to the prompt element.
     * @returns The rendered prompt piece or undefined if the element does not want to render anything.
     */
    abstract render(state: S, sizing: PromptSizing, progress?: Progress<ChatResponsePart>, token?: CancellationToken): Promise<PromptPiece | undefined> | PromptPiece | undefined;
}

### File: node_modules/@vscode/prompt-tsx/dist/base/promptElements.d.ts

Content:
import type { CancellationToken, LanguageModelToolResult } from 'vscode';
import { ChatRole } from './openai';
import { PromptElement } from './promptElement';
import { BasePromptElementProps, PromptPiece, PromptSizing } from './types';
export type ChatMessagePromptElement = SystemMessage | UserMessage | AssistantMessage;
export declare function isChatMessagePromptElement(element: unknown): element is ChatMessagePromptElement;
export interface ChatMessageProps extends BasePromptElementProps {
    role?: ChatRole;
    name?: string;
}
export declare class BaseChatMessage<T extends ChatMessageProps = ChatMessageProps> extends PromptElement<T> {
    render(): any;
}
/**
 * A {@link PromptElement} which can be rendered to an OpenAI system chat message.
 *
 * See {@link https://platform.openai.com/docs/api-reference/chat/create#chat-create-messages}
 */
export declare class SystemMessage extends BaseChatMessage {
    constructor(props: ChatMessageProps);
}
/**
 * A {@link PromptElement} which can be rendered to an OpenAI user chat message.
 *
 * See {@link https://platform.openai.com/docs/api-reference/chat/create#chat-create-messages}
 */
export declare class UserMessage extends BaseChatMessage {
    constructor(props: ChatMessageProps);
}
export interface ToolCall {
    id: string;
    function: ToolFunction;
    type: 'function';
}
export interface ToolFunction {
    arguments: string;
    name: string;
}
export interface AssistantMessageProps extends ChatMessageProps {
    toolCalls?: ToolCall[];
}
/**
 * A {@link PromptElement} which can be rendered to an OpenAI assistant chat message.
 *
 * See {@link https://platform.openai.com/docs/api-reference/chat/create#chat-create-messages}
 */
export declare class AssistantMessage extends BaseChatMessage<AssistantMessageProps> {
    constructor(props: AssistantMessageProps);
}
/**
 * A {@link PromptElement} which can be rendered to an OpenAI function chat message.
 *
 * See {@link https://platform.openai.com/docs/api-reference/chat/create#chat-create-messages}
 */
export declare class FunctionMessage extends BaseChatMessage {
    constructor(props: ChatMessageProps & {
        name: string;
    });
}
export interface ToolMessageProps extends ChatMessageProps {
    toolCallId: string;
}
/**
 * A {@link PromptElement} which can be rendered to an OpenAI tool chat message.
 *
 * See {@link https://platform.openai.com/docs/api-reference/chat/create#chat-create-messages}
 */
export declare class ToolMessage extends BaseChatMessage<ToolMessageProps> {
    constructor(props: ToolMessageProps);
}
export interface TextChunkProps extends BasePromptElementProps {
    /**
     * If defined, the text chunk will potentially truncate its contents at the
     * last occurrence of the string or regular expression to ensure its content
     * fits within in token budget.
     *
     * {@see BasePromptElementProps} for options to control how the token budget
     * is allocated.
     */
    breakOn?: RegExp | string;
    /** A shortcut for setting {@link breakOn} to `/\s+/g` */
    breakOnWhitespace?: boolean;
}
/**
 * A chunk of single-line or multi-line text that is a direct child of a {@link ChatMessagePromptElement}.
 *
 * TextChunks can only have text literals or intrinsic attributes as children.
 * It supports truncating text to fix the token budget if passed a {@link TextChunkProps.tokenizer} and {@link TextChunkProps.breakOn} behavior.
 * Like other {@link PromptElement}s, it can specify `priority` to determine how it should be prioritized.
 */
export declare class TextChunk extends PromptElement<TextChunkProps, PromptPiece> {
    prepare(sizing: PromptSizing, _progress?: unknown, token?: CancellationToken): Promise<PromptPiece>;
    render(piece: PromptPiece): PromptPiece<any, any>;
}
export interface PrioritizedListProps extends BasePromptElementProps {
    /**
     * Priority of the list element.
     * All rendered elements in this list receive a priority that is offset from this value.
     */
    priority?: number;
    /**
     * If `true`, assign higher priority to elements declared earlier in this list.
     */
    descending: boolean;
}
/**
 * A utility for assigning priorities to a list of prompt elements.
 */
export declare class PrioritizedList extends PromptElement<PrioritizedListProps> {
    render(): any;
}
export interface IToolResultProps extends BasePromptElementProps {
    /**
     * Base priority of the tool data. All tool data will be scoped to this priority.
     */
    priority?: number;
    /**
     * Tool result from VS Code.
     */
    data: LanguageModelToolResult;
}
/**
 * A utility to include the result of a tool called using the `vscode.lm.invokeTool` API.
 */
export declare class ToolResult extends PromptElement<IToolResultProps> {
    render(): Promise<PromptPiece | undefined> | PromptPiece | undefined;
}
/**
 * Marker element that uses the legacy global prioritization algorithm (0.2.x
 * if this library) for pruning child elements. This will be removed in
 * the future.
 *
 * @deprecated
 */
export declare class LegacyPrioritization extends PromptElement {
    render(): any;
}
/**
 * Marker element that ensures all of its children are either included, or
 * not included. This is similar to the `<TextChunk />` element, but it is more
 * basic and can contain extrinsic children.
 */
export declare class Chunk extends PromptElement<BasePromptElementProps> {
    render(): any;
}
export interface ExpandableProps extends BasePromptElementProps {
    value: (sizing: PromptSizing) => string | Promise<string>;
}
/**
 * An element that can expand to fill the remaining token budget. Takes
 * a `value` function that is initially called with the element's token budget,
 * and may be called multiple times with the new token budget as the prompt
 * is resized.
 */
export declare class Expandable extends PromptElement<ExpandableProps> {
    render(_state: void, sizing: PromptSizing): Promise<PromptPiece>;
}
export interface TokenLimitProps extends BasePromptElementProps {
    max: number;
}
/**
 * An element that ensures its children don't exceed a certain number of
 * `maxTokens`. Its contents are pruned to fit within the budget before
 * the overall prompt pruning is run.
 */
export declare class TokenLimit extends PromptElement<TokenLimitProps> {
    render(): PromptPiece;
}

### File: node_modules/@vscode/prompt-tsx/dist/base/promptRenderer.d.ts

Content:
import type { CancellationToken, Progress } from 'vscode';
import * as JSONT from './jsonTypes';
import { PromptNodeType } from './jsonTypes';
import { MaterializedChatMessage, MaterializedContainer } from './materialized';
import { ChatMessage } from './openai';
import { PromptElement } from './promptElement';
import { PromptMetadata, PromptReference } from './results';
import { ITokenizer } from './tokenizer/tokenizer';
import { ITracer } from './tracer';
import { BasePromptElementProps, IChatEndpointInfo, PromptElementCtor, PromptPieceChild } from './types';
import { URI } from './util/vs/common/uri';
import { ChatDocumentContext, ChatResponsePart } from './vscodeTypes';
export interface RenderPromptResult {
    readonly messages: ChatMessage[];
    readonly tokenCount: number;
    readonly hasIgnoredFiles: boolean;
    readonly metadata: MetadataMap;
    /**
     * The references that survived prioritization in the rendered {@link RenderPromptResult.messages messages}.
     */
    readonly references: PromptReference[];
    /**
     * The references attached to chat message chunks that did not survive prioritization.
     */
    readonly omittedReferences: PromptReference[];
}
export type QueueItem<C, P> = {
    node: PromptTreeElement;
    ctor: C;
    props: P;
    children: PromptPieceChild[];
};
export interface MetadataMap {
    get<T extends PromptMetadata>(key: new (...args: any[]) => T): T | undefined;
    getAll<T extends PromptMetadata>(key: new (...args: any[]) => T): T[];
}
export declare namespace MetadataMap {
    const empty: MetadataMap;
}
/**
 * A prompt renderer is responsible for rendering a {@link PromptElementCtor prompt element} to {@link ChatMessagePromptElement chat messages}.
 *
 * Note: You must create a fresh prompt renderer instance for each prompt element you want to render.
 */
export declare class PromptRenderer<P extends BasePromptElementProps> {
    private readonly _endpoint;
    private readonly _ctor;
    private readonly _props;
    private readonly _tokenizer;
    private readonly _usedContext;
    private readonly _ignoredFiles;
    private readonly _growables;
    private readonly _root;
    private readonly _tokenLimits;
    /** Epoch used to tracing the order in which elements render. */
    tracer: ITracer | undefined;
    /**
     * @param _endpoint The chat endpoint that the rendered prompt will be sent to.
     * @param _ctor The prompt element constructor to render.
     * @param _props The props to pass to the prompt element.
     */
    constructor(_endpoint: IChatEndpointInfo, _ctor: PromptElementCtor<P, any>, _props: P, _tokenizer: ITokenizer);
    getIgnoredFiles(): URI[];
    getUsedContext(): ChatDocumentContext[];
    protected createElement(element: QueueItem<PromptElementCtor<P, any>, P>): PromptElement<P, any>;
    private _processPromptPieces;
    private _processPromptRenderPiece;
    /**
     * Renders the prompt element and its children to a JSON-serializable state.
     * @returns A promise that resolves to an object containing the rendered chat messages and the total token count.
     * The total token count is guaranteed to be less than or equal to the token budget.
     */
    renderElementJSON(token?: CancellationToken): Promise<JSONT.PromptElementJSON>;
    /**
     * Renders the prompt element and its children.
     * @returns A promise that resolves to an object containing the rendered chat messages and the total token count.
     * The total token count is guaranteed to be less than or equal to the token budget.
     */
    render(progress?: Progress<ChatResponsePart>, token?: CancellationToken): Promise<RenderPromptResult>;
    /**
     * Note: this may be called multiple times from the tracer as users play
     * around with budgets. It should be side-effect-free.
     */
    private _getFinalElementTree;
    /** Grows all Expandable elements, returns if any changes were made. */
    private _grow;
    private _handlePromptChildren;
    private _handleIntrinsic;
    private _handleIntrinsicMeta;
    private _handleIntrinsicLineBreak;
    private _handleIntrinsicElementJSON;
    private _handleIntrinsicUsedContext;
    private _handleIntrinsicReferences;
    private _handleIntrinsicIgnoredFiles;
    /**
     * @param node Parent of the <TextChunk />
     * @param textChunkNode The <TextChunk /> node. All children are in-order
     * appended to the parent using the same sort index to ensure order is preserved.
     * @param props Props of the <TextChunk />
     * @param children Rendered children of the <TextChunk />
     */
    private _handleExtrinsicTextChunkChildren;
}
declare class PromptTreeElement {
    readonly parent: PromptTreeElement | null;
    readonly childIndex: number;
    readonly id: number;
    private static _nextId;
    static fromJSON(index: number, json: JSONT.PieceJSON): PromptTreeElement;
    readonly kind = PromptNodeType.Piece;
    private _obj;
    private _state;
    private _children;
    private _metadata;
    constructor(parent: (PromptTreeElement | null) | undefined, childIndex: number, id?: number);
    setObj(obj: PromptElement): void;
    getObj(): PromptElement | null;
    setState(state: any): void;
    getState(): any;
    createChild(): PromptTreeElement;
    appendPieceJSON(data: JSONT.PieceJSON): PromptTreeElement;
    appendStringChild(text: string, priority?: number, metadata?: PromptMetadata[], sortIndex?: number, lineBreakBefore?: boolean): void;
    appendLineBreak(priority?: number, sortIndex?: number): void;
    toJSON(): JSONT.PieceJSON;
    materialize(): MaterializedChatMessage | MaterializedContainer;
    addMetadata(metadata: PromptMetadata): void;
    elements(): Iterable<PromptTreeElement>;
}
export {};

### File: node_modules/@vscode/prompt-tsx/dist/base/results.d.ts

Content:
import type { Location, ThemeIcon, Uri } from 'vscode';
import * as JSON from './jsonTypes';
/**
 * Arbitrary metadata which can be retrieved after the prompt is rendered.
 */
export declare abstract class PromptMetadata {
    readonly _marker: undefined;
    toString(): string;
}
export declare enum ChatResponseReferencePartStatusKind {
    Complete = 1,
    Partial = 2,
    Omitted = 3
}
/**
 * A reference used for creating the prompt.
 */
export declare class PromptReference {
    readonly anchor: Uri | Location | {
        variableName: string;
        value?: Uri | Location;
    };
    readonly iconPath?: (Uri | ThemeIcon | {
        light: Uri;
        dark: Uri;
    }) | undefined;
    readonly options?: {
        status?: {
            description: string;
            kind: ChatResponseReferencePartStatusKind;
        };
    } | undefined;
    static fromJSON(json: JSON.PromptReferenceJSON): PromptReference;
    constructor(anchor: Uri | Location | {
        variableName: string;
        value?: Uri | Location;
    }, iconPath?: (Uri | ThemeIcon | {
        light: Uri;
        dark: Uri;
    }) | undefined, options?: {
        status?: {
            description: string;
            kind: ChatResponseReferencePartStatusKind;
        };
    } | undefined);
    toJSON(): JSON.PromptReferenceJSON;
}

### File: node_modules/@vscode/prompt-tsx/dist/base/tokenizer/tokenizer.d.ts

Content:
import type { CancellationToken, LanguageModelChatMessage } from 'vscode';
import { ChatMessage } from '../openai';
/**
 * Represents a tokenizer that can be used to tokenize text in chat messages.
 */
export interface ITokenizer {
    /**
     * Return the length of `text` in number of tokens.
     *
     * @param {str} text - The input text
     * @returns {number}
     */
    tokenLength(text: string, token?: CancellationToken): Promise<number> | number;
    countMessageTokens(message: ChatMessage): Promise<number> | number;
}
export declare class AnyTokenizer implements ITokenizer {
    private countTokens;
    constructor(countTokens: (text: string | LanguageModelChatMessage, token?: CancellationToken) => Thenable<number>);
    tokenLength(text: string, token?: CancellationToken): Promise<number>;
    countMessageTokens(message: ChatMessage): Promise<number>;
    private toChatRole;
}

### File: node_modules/@vscode/prompt-tsx/dist/base/tracer.d.ts

Content:
import { MaterializedContainer } from './materialized';
import { ITokenizer } from './tokenizer/tokenizer';
export interface ITraceRenderData {
    budget: number;
    container: MaterializedContainer;
    removed: number;
}
export interface ITraceData {
    /** Budget the tree was rendered with initially. */
    budget: number;
    /** Tree returned from the prompt. */
    renderedTree: ITraceRenderData;
    /** Tokenizer that was used. */
    tokenizer: ITokenizer;
    /** Callback the tracer and use to re-render the tree at the given budget. */
    renderTree(tokenBudget: number): Promise<ITraceRenderData>;
}
export interface IElementEpochData {
    id: number;
    tokenBudget: number;
}
export interface ITraceEpoch {
    inNode: number | undefined;
    flexValue: number;
    tokenBudget: number;
    reservedTokens: number;
    elements: IElementEpochData[];
}
/**
 * Handler that can trace rendering internals.
 */
export interface ITracer {
    /**
     * Called when a group of elements is rendered.
     */
    addRenderEpoch?(epoch: ITraceEpoch): void;
    /**
     * Adds an element into the current epoch.
     */
    includeInEpoch?(data: IElementEpochData): void;
    /**
     * Called when the elements have been processed into their final tree form.
     */
    didMaterializeTree?(traceData: ITraceData): void;
}

### File: node_modules/@vscode/prompt-tsx/dist/base/tsx-globals.d.ts

Content:
import { PromptElementJSON } from './jsonTypes';
import { PromptMetadata, PromptReference } from './results';
import { URI } from './util/vs/common/uri';
import { ChatDocumentContext } from './vscodeTypes';
declare global {
    namespace JSX {
        interface IntrinsicElements {
            /**
             * Add meta data which can be retrieved after the prompt is rendered.
             */
            meta: {
                value: PromptMetadata;
                /**
                 * If set, the metadata will only be included in the rendered result
                 * if the chunk it's in survives prioritization.
                 */
                local?: boolean;
            };
            /**
             * `\n` character.
             */
            br: {};
            /**
             * Expose context used for creating the prompt.
             */
            usedContext: {
                value: ChatDocumentContext[];
            };
            /**
             * Expose the references used for creating the prompt.
             * Will be displayed to the user.
             */
            references: {
                value: PromptReference[];
            };
            /**
             * Files that were excluded from the prompt.
             */
            ignoredFiles: {
                value: URI[];
            };
            /**
             * A JSON element previously rendered in {@link renderElementJSON}.
             */
            elementJSON: {
                data: PromptElementJSON;
            };
        }
    }
}

### File: node_modules/@vscode/prompt-tsx/dist/base/tsx.d.ts

Content:
interface _InternalPromptPiece<P = any> {
    ctor: string | any;
    props: P;
    children: string | (_InternalPromptPiece<any> | undefined)[];
}
/**
 * Visual Studio Code Prompt Piece
 */
declare function _vscpp(ctor: any, props: any, ...children: any[]): _InternalPromptPiece;
/**
 * Visual Studio Code Prompt Piece Fragment
 */
declare function _vscppf(): void;
declare namespace _vscppf {
    var isFragment: boolean;
}
declare const vscpp: typeof _vscpp;
declare const vscppf: typeof _vscppf;

### File: node_modules/@vscode/prompt-tsx/dist/base/types.d.ts

Content:
import { CancellationToken } from 'vscode';
import { PromptElement } from './promptElement';
/**
 * Represents information about a chat endpoint.
 */
export interface IChatEndpointInfo {
    /**
     * The maximum number of tokens allowed in the model prompt.
     */
    readonly modelMaxPromptTokens: number;
}
/**
 * The sizing hint for the prompt element. Prompt elements should take this into account when rendering.
 */
export interface PromptSizing {
    /**
     * The computed token allocation for this prompt element to adhere to when rendering,
     * if it specified {@link BasePromptElementProps.flexBasis}.
     */
    readonly tokenBudget: number;
    /**
     * Metadata about the endpoint being used.
     */
    readonly endpoint: IChatEndpointInfo;
    /**
     * Counts the number of tokens the text consumes.
     */
    countTokens(text: string, token?: CancellationToken): Promise<number> | number;
}
export interface BasePromptElementProps {
    /**
     * The absolute priority of the prompt element.
     *
     * If the messages to be sent exceed the available token budget, prompt elements will be removed from the rendered result, starting with the element with the lowest priority.
     *
     * If unset, defaults to `Number.MAX_SAFE_INTEGER`, such that elements with no explicit priority take the highest-priority position.
     */
    priority?: number;
    /**
     * If set, the children of the prompt element will be considered children of the parent during pruning. This allows you to create logical wrapper elements, for example:
     *
     * ```
     * <UserMessage>
     *   <MyContainer passPriority>
     *     <ChildA priority={1} />
     *     <ChildB priority={3} />
     *   </MyContainer>
     *   <ChildC priority={2} />
     * </UserMessage>
     * ```
     *
     * In this case where we have a wrapper element, the prune order would be `ChildA`, `ChildC`, then `ChildB`.
     */
    passPriority?: boolean;
    /**
     * The proportion of the container's {@link PromptSizing.tokenBudget token budget} that is assigned to this prompt element, based on the total weight requested by the prompt element and all its siblings.
     *
     * This is used to compute the {@link PromptSizing.tokenBudget token budget} hint that the prompt element receives.
     *
     * If set on a child element, the token budget is calculated with respect to all children under the element's parent, such that a child can never consume more tokens than its parent was allocated.
     *
     * Defaults to 1.
     */
    flexBasis?: number;
    /**
     * If set, sibling elements will be rendered first, followed by this element. The remaining {@link PromptSizing.tokenBudget token budget} from the container will be distributed among the elements with `flexGrow` set.
     *
     * If multiple elements are present with different values of `flexGrow` set, this process is repeated for each value of `flexGrow` in descending order.
     */
    flexGrow?: number;
    /**
     * If set with {@link flexGrow}, this defines the number of tokens this element
     * will reserve of the container {@link PromptSizing.tokenBudget token budget}
     * for sizing purposes in elements rendered before it.
     *
     * This can be set to a constant number of tokens, or a proportion of the
     * container's budget. For example, `/3` would reserve a third of the
     * container's budget.
     */
    flexReserve?: number | `/${number}`;
}
export interface PromptElementCtor<P extends BasePromptElementProps, S> {
    isFragment?: boolean;
    new (props: P, ...args: any[]): PromptElement<P, S>;
}
export interface RuntimePromptElementProps {
    children?: PromptPieceChild[];
}
export type PromptElementProps<T> = T & BasePromptElementProps & RuntimePromptElementProps;
export interface PromptPiece<P extends BasePromptElementProps = any, S = any> {
    ctor: string | PromptElementCtor<P, S>;
    props: P;
    children: PromptPieceChild[];
}
export type PromptPieceChild = number | string | PromptPiece<any> | undefined;

### File: node_modules/@vscode/prompt-tsx/dist/base/util/arrays.d.ts

Content:
/**
 * @returns New array with all falsy values removed. The original array IS NOT modified.
 */
export declare function coalesce<T>(array: ReadonlyArray<T | undefined | null>): T[];

### File: node_modules/@vscode/prompt-tsx/dist/base/util/vs/common/charCode.d.ts

Content:
/**
 * An inlined enum containing useful character codes (to be used with String.charCodeAt).
 * Please leave the const keyword such that it gets inlined when compiled to JavaScript!
 */
export declare const enum CharCode {
    Null = 0,
    /**
     * The `\b` character.
     */
    Backspace = 8,
    /**
     * The `\t` character.
     */
    Tab = 9,
    /**
     * The `\n` character.
     */
    LineFeed = 10,
    /**
     * The `\r` character.
     */
    CarriageReturn = 13,
    Space = 32,
    /**
     * The `!` character.
     */
    ExclamationMark = 33,
    /**
     * The `"` character.
     */
    DoubleQuote = 34,
    /**
     * The `#` character.
     */
    Hash = 35,
    /**
     * The `$` character.
     */
    DollarSign = 36,
    /**
     * The `%` character.
     */
    PercentSign = 37,
    /**
     * The `&` character.
     */
    Ampersand = 38,
    /**
     * The `'` character.
     */
    SingleQuote = 39,
    /**
     * The `(` character.
     */
    OpenParen = 40,
    /**
     * The `)` character.
     */
    CloseParen = 41,
    /**
     * The `*` character.
     */
    Asterisk = 42,
    /**
     * The `+` character.
     */
    Plus = 43,
    /**
     * The `,` character.
     */
    Comma = 44,
    /**
     * The `-` character.
     */
    Dash = 45,
    /**
     * The `.` character.
     */
    Period = 46,
    /**
     * The `/` character.
     */
    Slash = 47,
    Digit0 = 48,
    Digit1 = 49,
    Digit2 = 50,
    Digit3 = 51,
    Digit4 = 52,
    Digit5 = 53,
    Digit6 = 54,
    Digit7 = 55,
    Digit8 = 56,
    Digit9 = 57,
    /**
     * The `:` character.
     */
    Colon = 58,
    /**
     * The `;` character.
     */
    Semicolon = 59,
    /**
     * The `<` character.
     */
    LessThan = 60,
    /**
     * The `=` character.
     */
    Equals = 61,
    /**
     * The `>` character.
     */
    GreaterThan = 62,
    /**
     * The `?` character.
     */
    QuestionMark = 63,
    /**
     * The `@` character.
     */
    AtSign = 64,
    A = 65,
    B = 66,
    C = 67,
    D = 68,
    E = 69,
    F = 70,
    G = 71,
    H = 72,
    I = 73,
    J = 74,
    K = 75,
    L = 76,
    M = 77,
    N = 78,
    O = 79,
    P = 80,
    Q = 81,
    R = 82,
    S = 83,
    T = 84,
    U = 85,
    V = 86,
    W = 87,
    X = 88,
    Y = 89,
    Z = 90,
    /**
     * The `[` character.
     */
    OpenSquareBracket = 91,
    /**
     * The `\` character.
     */
    Backslash = 92,
    /**
     * The `]` character.
     */
    CloseSquareBracket = 93,
    /**
     * The `^` character.
     */
    Caret = 94,
    /**
     * The `_` character.
     */
    Underline = 95,
    /**
     * The ``(`)`` character.
     */
    BackTick = 96,
    a = 97,
    b = 98,
    c = 99,
    d = 100,
    e = 101,
    f = 102,
    g = 103,
    h = 104,
    i = 105,
    j = 106,
    k = 107,
    l = 108,
    m = 109,
    n = 110,
    o = 111,
    p = 112,
    q = 113,
    r = 114,
    s = 115,
    t = 116,
    u = 117,
    v = 118,
    w = 119,
    x = 120,
    y = 121,
    z = 122,
    /**
     * The `{` character.
     */
    OpenCurlyBrace = 123,
    /**
     * The `|` character.
     */
    Pipe = 124,
    /**
     * The `}` character.
     */
    CloseCurlyBrace = 125,
    /**
     * The `~` character.
     */
    Tilde = 126,
    /**
     * The &nbsp; (no-break space) character.
     * Unicode Character 'NO-BREAK SPACE' (U+00A0)
     */
    NoBreakSpace = 160,
    U_Combining_Grave_Accent = 768,//	U+0300	Combining Grave Accent
    U_Combining_Acute_Accent = 769,//	U+0301	Combining Acute Accent
    U_Combining_Circumflex_Accent = 770,//	U+0302	Combining Circumflex Accent
    U_Combining_Tilde = 771,//	U+0303	Combining Tilde
    U_Combining_Macron = 772,//	U+0304	Combining Macron
    U_Combining_Overline = 773,//	U+0305	Combining Overline
    U_Combining_Breve = 774,//	U+0306	Combining Breve
    U_Combining_Dot_Above = 775,//	U+0307	Combining Dot Above
    U_Combining_Diaeresis = 776,//	U+0308	Combining Diaeresis
    U_Combining_Hook_Above = 777,//	U+0309	Combining Hook Above
    U_Combining_Ring_Above = 778,//	U+030A	Combining Ring Above
    U_Combining_Double_Acute_Accent = 779,//	U+030B	Combining Double Acute Accent
    U_Combining_Caron = 780,//	U+030C	Combining Caron
    U_Combining_Vertical_Line_Above = 781,//	U+030D	Combining Vertical Line Above
    U_Combining_Double_Vertical_Line_Above = 782,//	U+030E	Combining Double Vertical Line Above
    U_Combining_Double_Grave_Accent = 783,//	U+030F	Combining Double Grave Accent
    U_Combining_Candrabindu = 784,//	U+0310	Combining Candrabindu
    U_Combining_Inverted_Breve = 785,//	U+0311	Combining Inverted Breve
    U_Combining_Turned_Comma_Above = 786,//	U+0312	Combining Turned Comma Above
    U_Combining_Comma_Above = 787,//	U+0313	Combining Comma Above
    U_Combining_Reversed_Comma_Above = 788,//	U+0314	Combining Reversed Comma Above
    U_Combining_Comma_Above_Right = 789,//	U+0315	Combining Comma Above Right
    U_Combining_Grave_Accent_Below = 790,//	U+0316	Combining Grave Accent Below
    U_Combining_Acute_Accent_Below = 791,//	U+0317	Combining Acute Accent Below
    U_Combining_Left_Tack_Below = 792,//	U+0318	Combining Left Tack Below
    U_Combining_Right_Tack_Below = 793,//	U+0319	Combining Right Tack Below
    U_Combining_Left_Angle_Above = 794,//	U+031A	Combining Left Angle Above
    U_Combining_Horn = 795,//	U+031B	Combining Horn
    U_Combining_Left_Half_Ring_Below = 796,//	U+031C	Combining Left Half Ring Below
    U_Combining_Up_Tack_Below = 797,//	U+031D	Combining Up Tack Below
    U_Combining_Down_Tack_Below = 798,//	U+031E	Combining Down Tack Below
    U_Combining_Plus_Sign_Below = 799,//	U+031F	Combining Plus Sign Below
    U_Combining_Minus_Sign_Below = 800,//	U+0320	Combining Minus Sign Below
    U_Combining_Palatalized_Hook_Below = 801,//	U+0321	Combining Palatalized Hook Below
    U_Combining_Retroflex_Hook_Below = 802,//	U+0322	Combining Retroflex Hook Below
    U_Combining_Dot_Below = 803,//	U+0323	Combining Dot Below
    U_Combining_Diaeresis_Below = 804,//	U+0324	Combining Diaeresis Below
    U_Combining_Ring_Below = 805,//	U+0325	Combining Ring Below
    U_Combining_Comma_Below = 806,//	U+0326	Combining Comma Below
    U_Combining_Cedilla = 807,//	U+0327	Combining Cedilla
    U_Combining_Ogonek = 808,//	U+0328	Combining Ogonek
    U_Combining_Vertical_Line_Below = 809,//	U+0329	Combining Vertical Line Below
    U_Combining_Bridge_Below = 810,//	U+032A	Combining Bridge Below
    U_Combining_Inverted_Double_Arch_Below = 811,//	U+032B	Combining Inverted Double Arch Below
    U_Combining_Caron_Below = 812,//	U+032C	Combining Caron Below
    U_Combining_Circumflex_Accent_Below = 813,//	U+032D	Combining Circumflex Accent Below
    U_Combining_Breve_Below = 814,//	U+032E	Combining Breve Below
    U_Combining_Inverted_Breve_Below = 815,//	U+032F	Combining Inverted Breve Below
    U_Combining_Tilde_Below = 816,//	U+0330	Combining Tilde Below
    U_Combining_Macron_Below = 817,//	U+0331	Combining Macron Below
    U_Combining_Low_Line = 818,//	U+0332	Combining Low Line
    U_Combining_Double_Low_Line = 819,//	U+0333	Combining Double Low Line
    U_Combining_Tilde_Overlay = 820,//	U+0334	Combining Tilde Overlay
    U_Combining_Short_Stroke_Overlay = 821,//	U+0335	Combining Short Stroke Overlay
    U_Combining_Long_Stroke_Overlay = 822,//	U+0336	Combining Long Stroke Overlay
    U_Combining_Short_Solidus_Overlay = 823,//	U+0337	Combining Short Solidus Overlay
    U_Combining_Long_Solidus_Overlay = 824,//	U+0338	Combining Long Solidus Overlay
    U_Combining_Right_Half_Ring_Below = 825,//	U+0339	Combining Right Half Ring Below
    U_Combining_Inverted_Bridge_Below = 826,//	U+033A	Combining Inverted Bridge Below
    U_Combining_Square_Below = 827,//	U+033B	Combining Square Below
    U_Combining_Seagull_Below = 828,//	U+033C	Combining Seagull Below
    U_Combining_X_Above = 829,//	U+033D	Combining X Above
    U_Combining_Vertical_Tilde = 830,//	U+033E	Combining Vertical Tilde
    U_Combining_Double_Overline = 831,//	U+033F	Combining Double Overline
    U_Combining_Grave_Tone_Mark = 832,//	U+0340	Combining Grave Tone Mark
    U_Combining_Acute_Tone_Mark = 833,//	U+0341	Combining Acute Tone Mark
    U_Combining_Greek_Perispomeni = 834,//	U+0342	Combining Greek Perispomeni
    U_Combining_Greek_Koronis = 835,//	U+0343	Combining Greek Koronis
    U_Combining_Greek_Dialytika_Tonos = 836,//	U+0344	Combining Greek Dialytika Tonos
    U_Combining_Greek_Ypogegrammeni = 837,//	U+0345	Combining Greek Ypogegrammeni
    U_Combining_Bridge_Above = 838,//	U+0346	Combining Bridge Above
    U_Combining_Equals_Sign_Below = 839,//	U+0347	Combining Equals Sign Below
    U_Combining_Double_Vertical_Line_Below = 840,//	U+0348	Combining Double Vertical Line Below
    U_Combining_Left_Angle_Below = 841,//	U+0349	Combining Left Angle Below
    U_Combining_Not_Tilde_Above = 842,//	U+034A	Combining Not Tilde Above
    U_Combining_Homothetic_Above = 843,//	U+034B	Combining Homothetic Above
    U_Combining_Almost_Equal_To_Above = 844,//	U+034C	Combining Almost Equal To Above
    U_Combining_Left_Right_Arrow_Below = 845,//	U+034D	Combining Left Right Arrow Below
    U_Combining_Upwards_Arrow_Below = 846,//	U+034E	Combining Upwards Arrow Below
    U_Combining_Grapheme_Joiner = 847,//	U+034F	Combining Grapheme Joiner
    U_Combining_Right_Arrowhead_Above = 848,//	U+0350	Combining Right Arrowhead Above
    U_Combining_Left_Half_Ring_Above = 849,//	U+0351	Combining Left Half Ring Above
    U_Combining_Fermata = 850,//	U+0352	Combining Fermata
    U_Combining_X_Below = 851,//	U+0353	Combining X Below
    U_Combining_Left_Arrowhead_Below = 852,//	U+0354	Combining Left Arrowhead Below
    U_Combining_Right_Arrowhead_Below = 853,//	U+0355	Combining Right Arrowhead Below
    U_Combining_Right_Arrowhead_And_Up_Arrowhead_Below = 854,//	U+0356	Combining Right Arrowhead And Up Arrowhead Below
    U_Combining_Right_Half_Ring_Above = 855,//	U+0357	Combining Right Half Ring Above
    U_Combining_Dot_Above_Right = 856,//	U+0358	Combining Dot Above Right
    U_Combining_Asterisk_Below = 857,//	U+0359	Combining Asterisk Below
    U_Combining_Double_Ring_Below = 858,//	U+035A	Combining Double Ring Below
    U_Combining_Zigzag_Above = 859,//	U+035B	Combining Zigzag Above
    U_Combining_Double_Breve_Below = 860,//	U+035C	Combining Double Breve Below
    U_Combining_Double_Breve = 861,//	U+035D	Combining Double Breve
    U_Combining_Double_Macron = 862,//	U+035E	Combining Double Macron
    U_Combining_Double_Macron_Below = 863,//	U+035F	Combining Double Macron Below
    U_Combining_Double_Tilde = 864,//	U+0360	Combining Double Tilde
    U_Combining_Double_Inverted_Breve = 865,//	U+0361	Combining Double Inverted Breve
    U_Combining_Double_Rightwards_Arrow_Below = 866,//	U+0362	Combining Double Rightwards Arrow Below
    U_Combining_Latin_Small_Letter_A = 867,//	U+0363	Combining Latin Small Letter A
    U_Combining_Latin_Small_Letter_E = 868,//	U+0364	Combining Latin Small Letter E
    U_Combining_Latin_Small_Letter_I = 869,//	U+0365	Combining Latin Small Letter I
    U_Combining_Latin_Small_Letter_O = 870,//	U+0366	Combining Latin Small Letter O
    U_Combining_Latin_Small_Letter_U = 871,//	U+0367	Combining Latin Small Letter U
    U_Combining_Latin_Small_Letter_C = 872,//	U+0368	Combining Latin Small Letter C
    U_Combining_Latin_Small_Letter_D = 873,//	U+0369	Combining Latin Small Letter D
    U_Combining_Latin_Small_Letter_H = 874,//	U+036A	Combining Latin Small Letter H
    U_Combining_Latin_Small_Letter_M = 875,//	U+036B	Combining Latin Small Letter M
    U_Combining_Latin_Small_Letter_R = 876,//	U+036C	Combining Latin Small Letter R
    U_Combining_Latin_Small_Letter_T = 877,//	U+036D	Combining Latin Small Letter T
    U_Combining_Latin_Small_Letter_V = 878,//	U+036E	Combining Latin Small Letter V
    U_Combining_Latin_Small_Letter_X = 879,//	U+036F	Combining Latin Small Letter X
    /**
     * Unicode Character 'LINE SEPARATOR' (U+2028)
     * http://www.fileformat.info/info/unicode/char/2028/index.htm
     */
    LINE_SEPARATOR = 8232,
    /**
     * Unicode Character 'PARAGRAPH SEPARATOR' (U+2029)
     * http://www.fileformat.info/info/unicode/char/2029/index.htm
     */
    PARAGRAPH_SEPARATOR = 8233,
    /**
     * Unicode Character 'NEXT LINE' (U+0085)
     * http://www.fileformat.info/info/unicode/char/0085/index.htm
     */
    NEXT_LINE = 133,
    U_CIRCUMFLEX = 94,// U+005E	CIRCUMFLEX
    U_GRAVE_ACCENT = 96,// U+0060	GRAVE ACCENT
    U_DIAERESIS = 168,// U+00A8	DIAERESIS
    U_MACRON = 175,// U+00AF	MACRON
    U_ACUTE_ACCENT = 180,// U+00B4	ACUTE ACCENT
    U_CEDILLA = 184,// U+00B8	CEDILLA
    U_MODIFIER_LETTER_LEFT_ARROWHEAD = 706,// U+02C2	MODIFIER LETTER LEFT ARROWHEAD
    U_MODIFIER_LETTER_RIGHT_ARROWHEAD = 707,// U+02C3	MODIFIER LETTER RIGHT ARROWHEAD
    U_MODIFIER_LETTER_UP_ARROWHEAD = 708,// U+02C4	MODIFIER LETTER UP ARROWHEAD
    U_MODIFIER_LETTER_DOWN_ARROWHEAD = 709,// U+02C5	MODIFIER LETTER DOWN ARROWHEAD
    U_MODIFIER_LETTER_CENTRED_RIGHT_HALF_RING = 722,// U+02D2	MODIFIER LETTER CENTRED RIGHT HALF RING
    U_MODIFIER_LETTER_CENTRED_LEFT_HALF_RING = 723,// U+02D3	MODIFIER LETTER CENTRED LEFT HALF RING
    U_MODIFIER_LETTER_UP_TACK = 724,// U+02D4	MODIFIER LETTER UP TACK
    U_MODIFIER_LETTER_DOWN_TACK = 725,// U+02D5	MODIFIER LETTER DOWN TACK
    U_MODIFIER_LETTER_PLUS_SIGN = 726,// U+02D6	MODIFIER LETTER PLUS SIGN
    U_MODIFIER_LETTER_MINUS_SIGN = 727,// U+02D7	MODIFIER LETTER MINUS SIGN
    U_BREVE = 728,// U+02D8	BREVE
    U_DOT_ABOVE = 729,// U+02D9	DOT ABOVE
    U_RING_ABOVE = 730,// U+02DA	RING ABOVE
    U_OGONEK = 731,// U+02DB	OGONEK
    U_SMALL_TILDE = 732,// U+02DC	SMALL TILDE
    U_DOUBLE_ACUTE_ACCENT = 733,// U+02DD	DOUBLE ACUTE ACCENT
    U_MODIFIER_LETTER_RHOTIC_HOOK = 734,// U+02DE	MODIFIER LETTER RHOTIC HOOK
    U_MODIFIER_LETTER_CROSS_ACCENT = 735,// U+02DF	MODIFIER LETTER CROSS ACCENT
    U_MODIFIER_LETTER_EXTRA_HIGH_TONE_BAR = 741,// U+02E5	MODIFIER LETTER EXTRA-HIGH TONE BAR
    U_MODIFIER_LETTER_HIGH_TONE_BAR = 742,// U+02E6	MODIFIER LETTER HIGH TONE BAR
    U_MODIFIER_LETTER_MID_TONE_BAR = 743,// U+02E7	MODIFIER LETTER MID TONE BAR
    U_MODIFIER_LETTER_LOW_TONE_BAR = 744,// U+02E8	MODIFIER LETTER LOW TONE BAR
    U_MODIFIER_LETTER_EXTRA_LOW_TONE_BAR = 745,// U+02E9	MODIFIER LETTER EXTRA-LOW TONE BAR
    U_MODIFIER_LETTER_YIN_DEPARTING_TONE_MARK = 746,// U+02EA	MODIFIER LETTER YIN DEPARTING TONE MARK
    U_MODIFIER_LETTER_YANG_DEPARTING_TONE_MARK = 747,// U+02EB	MODIFIER LETTER YANG DEPARTING TONE MARK
    U_MODIFIER_LETTER_UNASPIRATED = 749,// U+02ED	MODIFIER LETTER UNASPIRATED
    U_MODIFIER_LETTER_LOW_DOWN_ARROWHEAD = 751,// U+02EF	MODIFIER LETTER LOW DOWN ARROWHEAD
    U_MODIFIER_LETTER_LOW_UP_ARROWHEAD = 752,// U+02F0	MODIFIER LETTER LOW UP ARROWHEAD
    U_MODIFIER_LETTER_LOW_LEFT_ARROWHEAD = 753,// U+02F1	MODIFIER LETTER LOW LEFT ARROWHEAD
    U_MODIFIER_LETTER_LOW_RIGHT_ARROWHEAD = 754,// U+02F2	MODIFIER LETTER LOW RIGHT ARROWHEAD
    U_MODIFIER_LETTER_LOW_RING = 755,// U+02F3	MODIFIER LETTER LOW RING
    U_MODIFIER_LETTER_MIDDLE_GRAVE_ACCENT = 756,// U+02F4	MODIFIER LETTER MIDDLE GRAVE ACCENT
    U_MODIFIER_LETTER_MIDDLE_DOUBLE_GRAVE_ACCENT = 757,// U+02F5	MODIFIER LETTER MIDDLE DOUBLE GRAVE ACCENT
    U_MODIFIER_LETTER_MIDDLE_DOUBLE_ACUTE_ACCENT = 758,// U+02F6	MODIFIER LETTER MIDDLE DOUBLE ACUTE ACCENT
    U_MODIFIER_LETTER_LOW_TILDE = 759,// U+02F7	MODIFIER LETTER LOW TILDE
    U_MODIFIER_LETTER_RAISED_COLON = 760,// U+02F8	MODIFIER LETTER RAISED COLON
    U_MODIFIER_LETTER_BEGIN_HIGH_TONE = 761,// U+02F9	MODIFIER LETTER BEGIN HIGH TONE
    U_MODIFIER_LETTER_END_HIGH_TONE = 762,// U+02FA	MODIFIER LETTER END HIGH TONE
    U_MODIFIER_LETTER_BEGIN_LOW_TONE = 763,// U+02FB	MODIFIER LETTER BEGIN LOW TONE
    U_MODIFIER_LETTER_END_LOW_TONE = 764,// U+02FC	MODIFIER LETTER END LOW TONE
    U_MODIFIER_LETTER_SHELF = 765,// U+02FD	MODIFIER LETTER SHELF
    U_MODIFIER_LETTER_OPEN_SHELF = 766,// U+02FE	MODIFIER LETTER OPEN SHELF
    U_MODIFIER_LETTER_LOW_LEFT_ARROW = 767,// U+02FF	MODIFIER LETTER LOW LEFT ARROW
    U_GREEK_LOWER_NUMERAL_SIGN = 885,// U+0375	GREEK LOWER NUMERAL SIGN
    U_GREEK_TONOS = 900,// U+0384	GREEK TONOS
    U_GREEK_DIALYTIKA_TONOS = 901,// U+0385	GREEK DIALYTIKA TONOS
    U_GREEK_KORONIS = 8125,// U+1FBD	GREEK KORONIS
    U_GREEK_PSILI = 8127,// U+1FBF	GREEK PSILI
    U_GREEK_PERISPOMENI = 8128,// U+1FC0	GREEK PERISPOMENI
    U_GREEK_DIALYTIKA_AND_PERISPOMENI = 8129,// U+1FC1	GREEK DIALYTIKA AND PERISPOMENI
    U_GREEK_PSILI_AND_VARIA = 8141,// U+1FCD	GREEK PSILI AND VARIA
    U_GREEK_PSILI_AND_OXIA = 8142,// U+1FCE	GREEK PSILI AND OXIA
    U_GREEK_PSILI_AND_PERISPOMENI = 8143,// U+1FCF	GREEK PSILI AND PERISPOMENI
    U_GREEK_DASIA_AND_VARIA = 8157,// U+1FDD	GREEK DASIA AND VARIA
    U_GREEK_DASIA_AND_OXIA = 8158,// U+1FDE	GREEK DASIA AND OXIA
    U_GREEK_DASIA_AND_PERISPOMENI = 8159,// U+1FDF	GREEK DASIA AND PERISPOMENI
    U_GREEK_DIALYTIKA_AND_VARIA = 8173,// U+1FED	GREEK DIALYTIKA AND VARIA
    U_GREEK_DIALYTIKA_AND_OXIA = 8174,// U+1FEE	GREEK DIALYTIKA AND OXIA
    U_GREEK_VARIA = 8175,// U+1FEF	GREEK VARIA
    U_GREEK_OXIA = 8189,// U+1FFD	GREEK OXIA
    U_GREEK_DASIA = 8190,// U+1FFE	GREEK DASIA
    U_IDEOGRAPHIC_FULL_STOP = 12290,// U+3002	IDEOGRAPHIC FULL STOP
    U_LEFT_CORNER_BRACKET = 12300,// U+300C	LEFT CORNER BRACKET
    U_RIGHT_CORNER_BRACKET = 12301,// U+300D	RIGHT CORNER BRACKET
    U_LEFT_BLACK_LENTICULAR_BRACKET = 12304,// U+3010	LEFT BLACK LENTICULAR BRACKET
    U_RIGHT_BLACK_LENTICULAR_BRACKET = 12305,// U+3011	RIGHT BLACK LENTICULAR BRACKET
    U_OVERLINE = 8254,// Unicode Character 'OVERLINE'
    /**
     * UTF-8 BOM
     * Unicode Character 'ZERO WIDTH NO-BREAK SPACE' (U+FEFF)
     * http://www.fileformat.info/info/unicode/char/feff/index.htm
     */
    UTF8_BOM = 65279,
    U_FULLWIDTH_SEMICOLON = 65307,// U+FF1B	FULLWIDTH SEMICOLON
    U_FULLWIDTH_COMMA = 65292
}

### File: node_modules/@vscode/prompt-tsx/dist/base/util/vs/common/marshallingIds.d.ts

Content:
export declare const enum MarshalledId {
    Uri = 1,
    Regexp = 2,
    ScmResource = 3,
    ScmResourceGroup = 4,
    ScmProvider = 5,
    CommentController = 6,
    CommentThread = 7,
    CommentThreadInstance = 8,
    CommentThreadReply = 9,
    CommentNode = 10,
    CommentThreadNode = 11,
    TimelineActionContext = 12,
    NotebookCellActionContext = 13,
    NotebookActionContext = 14,
    TerminalContext = 15,
    TestItemContext = 16,
    Date = 17,
    TestMessageMenuArgs = 18
}

### File: node_modules/@vscode/prompt-tsx/dist/base/util/vs/common/path.d.ts

Content:
export interface ParsedPath {
    root: string;
    dir: string;
    base: string;
    ext: string;
    name: string;
}
export interface IPath {
    normalize(path: string): string;
    isAbsolute(path: string): boolean;
    join(...paths: string[]): string;
    resolve(...pathSegments: string[]): string;
    relative(from: string, to: string): string;
    dirname(path: string): string;
    basename(path: string, ext?: string): string;
    extname(path: string): string;
    format(pathObject: ParsedPath): string;
    parse(path: string): ParsedPath;
    toNamespacedPath(path: string): string;
    sep: '\\' | '/';
    delimiter: string;
    win32: IPath | null;
    posix: IPath | null;
}
export declare const win32: IPath;
export declare const posix: IPath;
export declare const normalize: (path: string) => string;
export declare const isAbsolute: (path: string) => boolean;
export declare const join: (...paths: string[]) => string;
export declare const resolve: (...pathSegments: string[]) => string;
export declare const relative: (from: string, to: string) => string;
export declare const dirname: (path: string) => string;
export declare const basename: (path: string, ext?: string) => string;
export declare const extname: (path: string) => string;
export declare const format: (pathObject: ParsedPath) => string;
export declare const parse: (path: string) => ParsedPath;
export declare const toNamespacedPath: (path: string) => string;
export declare const sep: "/" | "\\";
export declare const delimiter: string;

### File: node_modules/@vscode/prompt-tsx/dist/base/util/vs/common/platform.d.ts

Content:
export declare const LANGUAGE_DEFAULT = "en";
export interface IProcessEnvironment {
    [key: string]: string | undefined;
}
/**
 * This interface is intentionally not identical to node.js
 * process because it also works in sandboxed environments
 * where the process object is implemented differently. We
 * define the properties here that we need for `platform`
 * to work and nothing else.
 */
export interface INodeProcess {
    platform: string;
    arch: string;
    env: IProcessEnvironment;
    versions?: {
        electron?: string;
        chrome?: string;
    };
    type?: string;
    cwd: () => string;
}
export declare const enum Platform {
    Web = 0,
    Mac = 1,
    Linux = 2,
    Windows = 3
}
export type PlatformName = 'Web' | 'Windows' | 'Mac' | 'Linux';
export declare function PlatformToString(platform: Platform): PlatformName;
export declare const isWindows: boolean;
export declare const isMacintosh: boolean;
export declare const isLinux: boolean;
export declare const isLinuxSnap: boolean;
export declare const isNative: boolean;
export declare const isElectron: boolean;
export declare const isWeb: boolean;
export declare const isWebWorker: boolean;
export declare const webWorkerOrigin: any;
export declare const isIOS: boolean;
export declare const isMobile: boolean;
/**
 * Whether we run inside a CI environment, such as
 * GH actions or Azure Pipelines.
 */
export declare const isCI: boolean;
export declare const platform: Platform;
export declare const userAgent: string | undefined;
/**
 * The language used for the user interface. The format of
 * the string is all lower case (e.g. zh-tw for Traditional
 * Chinese)
 */
export declare const language: string;
export declare namespace Language {
    function value(): string;
    function isDefaultVariant(): boolean;
    function isDefault(): boolean;
}
/**
 * The OS locale or the locale specified by --locale. The format of
 * the string is all lower case (e.g. zh-tw for Traditional
 * Chinese). The UI is not necessarily shown in the provided locale.
 */
export declare const locale: string | undefined;
/**
 * This will always be set to the OS/browser's locale regardless of
 * what was specified by --locale. The format of the string is all
 * lower case (e.g. zh-tw for Traditional Chinese). The UI is not
 * necessarily shown in the provided locale.
 */
export declare const platformLocale: string;
/**
 * The translations that are available through language packs.
 */
export declare const translationsConfigFile: string | undefined;
export declare const setTimeout0IsFaster: boolean;
/**
 * See https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#:~:text=than%204%2C%20then-,set%20timeout%20to%204,-.
 *
 * Works similarly to `setTimeout(0)` but doesn't suffer from the 4ms artificial delay
 * that browsers set when the nesting level is > 5.
 */
export declare const setTimeout0: (callback: () => void) => void;
export declare const enum OperatingSystem {
    Windows = 1,
    Macintosh = 2,
    Linux = 3
}
export declare const OS: OperatingSystem;
export declare function isLittleEndian(): boolean;
export declare const isChrome: boolean;
export declare const isFirefox: boolean;
export declare const isSafari: boolean;
export declare const isEdge: boolean;
export declare const isAndroid: boolean;
export declare function isBigSurOrNewer(osVersion: string): boolean;

### File: node_modules/@vscode/prompt-tsx/dist/base/util/vs/common/process.d.ts

Content:
/**
 * Provides safe access to the `cwd` property in node.js, sandboxed or web
 * environments.
 *
 * Note: in web, this property is hardcoded to be `/`.
 *
 * @skipMangle
 */
export declare const cwd: () => string;
/**
 * Provides safe access to the `env` property in node.js, sandboxed or web
 * environments.
 *
 * Note: in web, this property is hardcoded to be `{}`.
 */
export declare const env: import("./platform").IProcessEnvironment;
/**
 * Provides safe access to the `platform` property in node.js, sandboxed or web
 * environments.
 */
export declare const platform: string;
/**
 * Provides safe access to the `arch` method in node.js, sandboxed or web
 * environments.
 * Note: `arch` is `undefined` in web
 */
export declare const arch: string | undefined;

### File: node_modules/@vscode/prompt-tsx/dist/base/util/vs/common/uri.d.ts

Content:
/**
 * Uniform Resource Identifier (URI) http://tools.ietf.org/html/rfc3986.
 * This class is a simple parser which creates the basic component parts
 * (http://tools.ietf.org/html/rfc3986#section-3) with minimal validation
 * and encoding.
 *
 * ```txt
 *       foo://example.com:8042/over/there?name=ferret#nose
 *       \_/   \______________/\_________/ \_________/ \__/
 *        |           |            |            |        |
 *     scheme     authority       path        query   fragment
 *        |   _____________________|__
 *       / \ /                        \
 *       urn:example:animal:ferret:nose
 * ```
 */
export declare class URI implements UriComponents {
    static isUri(thing: any): thing is URI;
    /**
     * scheme is the 'http' part of 'http://www.example.com/some/path?query#fragment'.
     * The part before the first colon.
     */
    readonly scheme: string;
    /**
     * authority is the 'www.example.com' part of 'http://www.example.com/some/path?query#fragment'.
     * The part between the first double slashes and the next slash.
     */
    readonly authority: string;
    /**
     * path is the '/some/path' part of 'http://www.example.com/some/path?query#fragment'.
     */
    readonly path: string;
    /**
     * query is the 'query' part of 'http://www.example.com/some/path?query#fragment'.
     */
    readonly query: string;
    /**
     * fragment is the 'fragment' part of 'http://www.example.com/some/path?query#fragment'.
     */
    readonly fragment: string;
    /**
     * @internal
     */
    protected constructor(scheme: string, authority?: string, path?: string, query?: string, fragment?: string, _strict?: boolean);
    /**
     * @internal
     */
    protected constructor(components: UriComponents);
    /**
     * Returns a string representing the corresponding file system path of this URI.
     * Will handle UNC paths, normalizes windows drive letters to lower-case, and uses the
     * platform specific path separator.
     *
     * * Will *not* validate the path for invalid characters and semantics.
     * * Will *not* look at the scheme of this URI.
     * * The result shall *not* be used for display purposes but for accessing a file on disk.
     *
     *
     * The *difference* to `URI#path` is the use of the platform specific separator and the handling
     * of UNC paths. See the below sample of a file-uri with an authority (UNC path).
     *
     * ```ts
        const u = URI.parse('file://server/c$/folder/file.txt')
        u.authority === 'server'
        u.path === '/shares/c$/file.txt'
        u.fsPath === '\\server\c$\folder\file.txt'
    ```
     *
     * Using `URI#path` to read a file (using fs-apis) would not be enough because parts of the path,
     * namely the server name, would be missing. Therefore `URI#fsPath` exists - it's sugar to ease working
     * with URIs that represent files on disk (`file` scheme).
     */
    get fsPath(): string;
    with(change: {
        scheme?: string;
        authority?: string | null;
        path?: string | null;
        query?: string | null;
        fragment?: string | null;
    }): URI;
    /**
     * Creates a new URI from a string, e.g. `http://www.example.com/some/path`,
     * `file:///usr/home`, or `scheme:with/path`.
     *
     * @param value A string which represents an URI (see `URI#toString`).
     */
    static parse(value: string, _strict?: boolean): URI;
    /**
     * Creates a new URI from a file system path, e.g. `c:\my\files`,
     * `/usr/home`, or `\\server\share\some\path`.
     *
     * The *difference* between `URI#parse` and `URI#file` is that the latter treats the argument
     * as path, not as stringified-uri. E.g. `URI.file(path)` is **not the same as**
     * `URI.parse('file://' + path)` because the path might contain characters that are
     * interpreted (# and ?). See the following sample:
     * ```ts
    const good = URI.file('/coding/c#/project1');
    good.scheme === 'file';
    good.path === '/coding/c#/project1';
    good.fragment === '';
    const bad = URI.parse('file://' + '/coding/c#/project1');
    bad.scheme === 'file';
    bad.path === '/coding/c'; // path is now broken
    bad.fragment === '/project1';
    ```
     *
     * @param path A file system path (see `URI#fsPath`)
     */
    static file(path: string): URI;
    /**
     * Creates new URI from uri components.
     *
     * Unless `strict` is `true` the scheme is defaults to be `file`. This function performs
     * validation and should be used for untrusted uri components retrieved from storage,
     * user input, command arguments etc
     */
    static from(components: UriComponents, strict?: boolean): URI;
    /**
     * Join a URI path with path fragments and normalizes the resulting path.
     *
     * @param uri The input URI.
     * @param pathFragment The path fragment to add to the URI path.
     * @returns The resulting URI.
     */
    static joinPath(uri: URI, ...pathFragment: string[]): URI;
    /**
     * Creates a string representation for this URI. It's guaranteed that calling
     * `URI.parse` with the result of this function creates an URI which is equal
     * to this URI.
     *
     * * The result shall *not* be used for display purposes but for externalization or transport.
     * * The result will be encoded using the percentage encoding and encoding happens mostly
     * ignore the scheme-specific encoding rules.
     *
     * @param skipEncoding Do not encode the result, default is `false`
     */
    toString(skipEncoding?: boolean): string;
    toJSON(): UriComponents;
    /**
     * A helper function to revive URIs.
     *
     * **Note** that this function should only be used when receiving URI#toJSON generated data
     * and that it doesn't do any validation. Use {@link URI.from} when received "untrusted"
     * uri components such as command arguments or data from storage.
     *
     * @param data The URI components or URI to revive.
     * @returns The revived URI or undefined or null.
     */
    static revive(data: UriComponents | URI): URI;
    static revive(data: UriComponents | URI | undefined): URI | undefined;
    static revive(data: UriComponents | URI | null): URI | null;
    static revive(data: UriComponents | URI | undefined | null): URI | undefined | null;
}
export interface UriComponents {
    scheme: string;
    authority?: string;
    path?: string;
    query?: string;
    fragment?: string;
}
export declare function isUriComponents(thing: any): thing is UriComponents;
/**
 * Compute `fsPath` for the given uri
 */
export declare function uriToFsPath(uri: URI, keepDriveLetterCasing: boolean): string;
/**
 * Mapped-type that replaces all occurrences of URI with UriComponents
 */
export type UriDto<T> = {
    [K in keyof T]: T[K] extends URI ? UriComponents : UriDto<T[K]>;
};

### File: node_modules/@vscode/prompt-tsx/dist/base/util/vs/nls.d.ts

Content:
export interface ILocalizeInfo {
    key: string;
    comment: string[];
}
interface ILocalizedString {
    original: string;
    value: string;
}
export declare function localize(data: ILocalizeInfo | string, message: string, ...args: any[]): string;
export declare function localize2(data: ILocalizeInfo | string, message: string, ...args: any[]): ILocalizedString;
export declare function getConfiguredDefaultLocale(_: string): undefined;
export {};

### File: node_modules/@vscode/prompt-tsx/dist/base/vscodeTypes.d.ts

Content:
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type {
	CancellationToken,
	Command,
	Location,
	MarkdownString,
	ProviderResult,
	Range,
	ThemeIcon,
	Uri,
} from 'vscode';

/**
 * Represents a part of a chat response that is formatted as Markdown.
 */
export class ChatResponseMarkdownPart {
	/**
	 * A markdown string or a string that should be interpreted as markdown.
	 */
	value: MarkdownString;

	/**
	 * Create a new ChatResponseMarkdownPart.
	 *
	 * @param value A markdown string or a string that should be interpreted as markdown. The boolean form of {@link MarkdownString.isTrusted} is NOT supported.
	 */
	constructor(value: string | MarkdownString);
}

/**
 * Represents a file tree structure in a chat response.
 */
export interface ChatResponseFileTree {
	/**
	 * The name of the file or directory.
	 */
	name: string;

	/**
	 * An array of child file trees, if the current file tree is a directory.
	 */
	children?: ChatResponseFileTree[];
}

/**
 * Represents a part of a chat response that is a file tree.
 */
export class ChatResponseFileTreePart {
	/**
	 * File tree data.
	 */
	value: ChatResponseFileTree[];

	/**
	 * The base uri to which this file tree is relative
	 */
	baseUri: Uri;

	/**
	 * Create a new ChatResponseFileTreePart.
	 * @param value File tree data.
	 * @param baseUri The base uri to which this file tree is relative.
	 */
	constructor(value: ChatResponseFileTree[], baseUri: Uri);
}

/**
 * Represents a part of a chat response that is an anchor, that is rendered as a link to a target.
 */
export class ChatResponseAnchorPart {
	/**
	 * The target of this anchor.
	 */
	value: Uri | Location;

	/**
	 * An optional title that is rendered with value.
	 */
	title?: string;

	/**
	 * Create a new ChatResponseAnchorPart.
	 * @param value A uri or location.
	 * @param title An optional title that is rendered with value.
	 */
	constructor(value: Uri | Location, title?: string);
}

/**
 * Represents a part of a chat response that is a progress message.
 */
export class ChatResponseProgressPart {
	/**
	 * The progress message
	 */
	value: string;

	/**
	 * Create a new ChatResponseProgressPart.
	 * @param value A progress message
	 */
	constructor(value: string);
}

/**
 * Represents a part of a chat response that is a reference, rendered separately from the content.
 */
export class ChatResponseReferencePart {
	/**
	 * The reference target.
	 */
	value: Uri | Location;

	/**
	 * The icon for the reference.
	 */
	iconPath?:
		| Uri
		| ThemeIcon
		| {
			/**
			 * The icon path for the light theme.
			 */
			light: Uri;
			/**
			 * The icon path for the dark theme.
			 */
			dark: Uri;
		};

	/**
	 * Create a new ChatResponseReferencePart.
	 * @param value A uri or location
	 * @param iconPath Icon for the reference shown in UI
	 */
	constructor(
		value: Uri | Location,
		iconPath?:
			| Uri
			| ThemeIcon
			| {
				/**
				 * The icon path for the light theme.
				 */
				light: Uri;
				/**
				 * The icon path for the dark theme.
				 */
				dark: Uri;
			}
	);
}

/**
 * Represents a part of a chat response that is a button that executes a command.
 */
export class ChatResponseCommandButtonPart {
	/**
	 * The command that will be executed when the button is clicked.
	 */
	value: Command;

	/**
	 * Create a new ChatResponseCommandButtonPart.
	 * @param value A Command that will be executed when the button is clicked.
	 */
	constructor(value: Command);
}

/**
 * Represents the different chat response types.
 */
export type ChatResponsePart =
	| ChatResponseMarkdownPart
	| ChatResponseFileTreePart
	| ChatResponseAnchorPart
	| ChatResponseProgressPart
	| ChatResponseReferencePart
	| ChatResponseCommandButtonPart;

export interface ChatDocumentContext {
	uri: Uri;
	version: number;
	ranges: Range[];
}

/**
 * Represents the role of a chat message. This is either the user or the assistant.
 */
export enum LanguageModelChatMessageRole {
	/**
	 * The user role, e.g the human interacting with a language model.
	 */
	User = 1,

	/**
	 * The assistant role, e.g. the language model generating responses.
	 */
	Assistant = 2,
}

