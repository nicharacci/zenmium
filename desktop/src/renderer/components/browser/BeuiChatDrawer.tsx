import { CHAT_IPC, chatIsBusy, safeChatUrl, type ChatAttachment, type ChatChange, type ChatContext, type ChatConversation, type ChatModel, type ChatResult } from "@shared/agent-chat";
import { CHROME_IPC, type BrowserSurfaceProps } from "@shared/browser-ui";
import { ARC_IPC } from "@shared/ipc";
import { Archive, Bookmark, FilePlus2, MessageCircle, Plus, Settings2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AgentActivity } from "../agents/agent-activity";
import { ChatApp } from "../agents/chat-app";
import { Message, MessageContent, MessageScroller } from "../agents/message";
import { PromptInput, type PromptAction } from "../agents/prompt-input";
import { StreamingResponse } from "../agents/streaming-response";
import "../../styles/zen-chat.css";

type ChatDrawerProps = Pick<BrowserSurfaceProps, "state" | "ui" | "invoke">;
const composerActions: PromptAction[] = [
  { value: "current-page", label: "Use current page", description: "Capture safe page content from this Workspace.", icon: <Archive aria-hidden="true" /> },
  { value: "attach-file", label: "Add a file", description: "Choose text, images, or a PDF to send.", icon: <FilePlus2 aria-hidden="true" /> },
  { value: "saved-pages", label: "Use saved pages", description: "Include actual Workspace bookmark destinations.", icon: <Bookmark aria-hidden="true" /> },
  { value: "models", label: "Connect models", description: "Discover models from configured providers.", icon: <Settings2 aria-hidden="true" /> },
];
function unwrap<T>(result: ChatResult<T>): T {
  if (!result || result.ok !== true) throw new Error(result?.ok === false ? result.reason : "The chat service is unavailable.");
  return result.value;
}
/** React-escaped text and protocol-checked links only. Never interpret model HTML/SVG. */
function ResponseText({ text }: { text: string }) {
  return <div className="zen-chat-response-text">{text.split(/(https?:\/\/[^\s<>"\]]+)/g).map((part, index) => {
    const url = part.startsWith("http") ? safeChatUrl(part.replace(/[).,;]+$/, "")) : null;
    return url ? <a href={url} key={index}>{part}</a> : part;
  })}</div>;
}

export function BeuiChatDrawer({ state, ui, invoke }: ChatDrawerProps) {
  const [conversation, setConversation] = useState<ChatConversation | null>(null);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [contexts, setContexts] = useState<ChatContext[]>([]);
  const [catalog, setCatalog] = useState<ChatModel[]>([]);
  const [model, setModel] = useState<string>();
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const activeId = useRef<string | null>(null);
  const initialCreation = useRef<Promise<ChatConversation> | null>(null);
  const creationSpaceId = useRef<string | null>(null);
  const requestedId = ui.overlay?.chatId;
  const busy = loading || chatIsBusy(conversation?.status);
  const space = state.spaces.find((item) => item.id === (conversation?.spaceId ?? state.activeSpaceId));

  const apply = useCallback((next: ChatConversation) => {
    if (activeId.current !== next.id) return;
    setConversation((current) => !current || next.revision >= current.revision ? next : current);
  }, []);
  useEffect(() => window.zenmium?.on(CHAT_IPC.event, (value) => {
    const event = value as ChatChange;
    if (event?.version === 1 && event.conversation) apply(event.conversation);
  }), [apply]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    const read = async () => {
      let entry: ChatConversation;
      if (requestedId) entry = unwrap(await invoke<ChatResult<ChatConversation>>(CHAT_IPC.get, { conversationId: requestedId }));
      else {
        // StrictMode reruns effects; hold one creation until its ID is anchored in chrome.
        if (!initialCreation.current || creationSpaceId.current !== state.activeSpaceId) {
          creationSpaceId.current = state.activeSpaceId;
          initialCreation.current = invoke<ChatResult<ChatConversation>>(CHAT_IPC.create, { spaceId: state.activeSpaceId }).then(unwrap);
        }
        entry = await initialCreation.current;
      }
      if (cancelled) return;
      activeId.current = entry.id;
      setConversation(entry);
      setModel(entry.model);
      setDraft(""); setAttachments([]); setContexts([]); setLoading(false);
      if (!requestedId) void invoke(CHROME_IPC.open, { kind: "agent", chatId: entry.id, spaceId: entry.spaceId });
    };
    void read().catch(() => { if (!cancelled) setError("This conversation could not be opened. Its saved history has not been changed."); });
    return () => { cancelled = true; };
  }, [invoke, requestedId, state.activeSpaceId]);

  const refreshModels = useCallback(async (connect = false) => {
    setConnecting(connect);
    try {
      const value = unwrap(await invoke<ChatResult<{ models: ChatModel[]; defaultModel: string; enabled: boolean }>>(CHAT_IPC.models, { connect }));
      setEnabled(value.enabled); setCatalog(value.models); setModel((current) => current ?? value.defaultModel);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Models are unavailable."); }
    finally { setConnecting(false); }
  }, [invoke]);
  useEffect(() => { void refreshModels(false); }, [refreshModels]);

  const run = async (channel: string, payload: Record<string, unknown> = {}) => {
    if (!conversation) return;
    const id = conversation.id;
    setError(null); setLoading(true);
    try { apply(unwrap(await invoke<ChatResult<ChatConversation>>(channel, { conversationId: id, ...payload }))); }
    catch (failure) { if (activeId.current === id) setError(failure instanceof Error ? failure.message : "The agent request failed."); }
    finally {
      if (activeId.current === id) setLoading(false);
      try { apply(unwrap(await invoke<ChatResult<ChatConversation>>(CHAT_IPC.get, { conversationId: id }))); } catch { /* Preserve last good snapshot. */ }
    }
  };
  const submit = async (text: string) => {
    if (!conversation || busy) return;
    setDraft("");
    const attachmentIds = attachments.map((item) => item.id), contextIds = contexts.map((item) => item.id);
    setAttachments([]); setContexts([]);
    await run(CHAT_IPC.prompt, { requestId: crypto.randomUUID(), text, model, attachmentIds, contextIds });
  };
  const action = async (value: string) => {
    setError(null);
    if (value === "models") { await refreshModels(true); return; }
    if (!conversation) return;
    try {
      if (value === "attach-file") {
        const files = unwrap(await invoke<ChatResult<ChatAttachment[]>>(CHAT_IPC.attach, { conversationId: conversation.id }));
        setAttachments((current) => [...current, ...files]);
      } else {
        const captured = unwrap(await invoke<ChatResult<ChatContext[]>>(CHAT_IPC.context, {
          conversationId: conversation.id, kind: value === "current-page" ? "page" : "bookmarks",
          ...(value === "current-page" ? { tabId: state.activeTabId ?? undefined } : {}),
        }));
        setContexts(captured);
        if (!captured.length) setError("There are no eligible pages in this Workspace to include.");
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Context could not be added."); }
  };
  const newConversation = async () => {
    try {
      const entry = unwrap(await invoke<ChatResult<ChatConversation>>(CHAT_IPC.create, { spaceId: state.activeSpaceId }));
      activeId.current = entry.id; setConversation(entry); setDraft(""); setAttachments([]); setContexts([]); setError(null); setLoading(false);
      void invoke(CHROME_IPC.open, { kind: "agent", chatId: entry.id, spaceId: entry.spaceId });
    } catch { setError("A new conversation could not be saved."); }
  };

  return (
    <div className="zen-beui-chat-drawer zen-chat-v1" data-beui-chat-app="true" onClickCapture={(event) => {
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      const url = target ? safeChatUrl(target.getAttribute("href") ?? "") : null;
      if (url) { event.preventDefault(); event.stopPropagation(); void invoke(ARC_IPC.newTab, { url, spaceId: conversation?.spaceId ?? state.activeSpaceId }); }
    }}>
      <ChatApp aria-label="Agent chat" className="zen-beui-chat-app" open={false} sidebarWidth="0px">
        <main className="zen-beui-chat-main">
          <div className="zen-beui-chat-title-overlay"><strong>{conversation?.title ?? "New conversation"}</strong><span>{space?.name ?? "Workspace"}</span></div>
          <div className="zen-chat-session-actions">
            <button type="button" title="New conversation" aria-label="New conversation" onClick={() => void newConversation()}><Plus size={14} /></button>
            <button type="button" title="Close chat, keep browsing" aria-label="Close chat" onClick={() => void invoke(CHROME_IPC.close)}><X size={14} /></button>
          </div>
          <MessageScroller className="zen-beui-chat-messages" contentClassName="zen-beui-chat-message-list" label="Conversation" navigation="rail" navigationLabel="Conversation history">
            {conversation?.messages.length ? conversation.messages.map((message, index) => (
              <Message from={message.from} key={message.id}>
                <MessageContent>
                  {message.from === "assistant" ? <StreamingResponse status={message.status === "streaming" ? "streaming" : message.status === "error" ? "error" : "complete"} copyText={message.text} showActions={false}>
                    <ResponseText text={message.text || (message.status === "streaming" ? "Working…" : "No text response was returned.")} />
                  </StreamingResponse> : <ResponseText text={message.text} />}
                  {message.attachments?.map((file) => <span className="zen-chat-file-receipt" key={file.id}>{file.filename}</span>)}
                  {message.sources?.length ? <div className="zen-chat-source-receipts">{message.sources.map((source, sourceIndex) => <a href={source.url} key={sourceIndex} title={source.url}>{source.title || source.url}</a>)}</div> : null}
                  {message.from === "assistant" && index === conversation.messages.length - 1 && !busy ? <div className="zen-chat-response-actions"><button type="button" onClick={() => void navigator.clipboard.writeText(message.text)} title="Copy response">Copy</button><button type="button" onClick={() => void run(CHAT_IPC.retry)} title="Regenerate the answer without repeating browser actions">Retry answer</button></div> : null}
                </MessageContent>
              </Message>
            )) : <div className="zen-beui-chat-empty"><span className="zen-beui-chat-empty-icon"><MessageCircle aria-hidden="true" size={16} /></span><strong>Browse together</strong><p>Research, summarize, or act on the web without interrupting your browsing.</p></div>}
            {conversation?.activity.length ? <AgentActivity items={conversation.activity.map((item) => ({ id: item.id, type: "step" as const, label: item.label, status: item.status === "running" ? "active" as const : "complete" as const, meta: item.status === "error" ? "Failed" : undefined }))} status={busy ? "working" : "complete"} summary="Browser and tool activity" activeLabel="Agent activity" maxHeight={180} /> : null}
          </MessageScroller>
          <div className="zen-beui-chat-composer-wrap">
            {error || conversation?.reason ? <p role="status" className="zen-chat-status">{error ?? conversation?.reason}</p> : null}
            {!enabled ? <button className="zen-chat-inline-action" type="button" onClick={() => void invoke(CHROME_IPC.open, { kind: "settings" })}>Agent is off · Open Settings</button> : null}
            {enabled && !catalog.some((item) => item.available) ? <button className="zen-chat-inline-action" type="button" disabled={connecting} onClick={() => void refreshModels(true)}>{connecting ? "Connecting…" : "Connect configured models"}</button> : null}
            {conversation && ["stopped", "interrupted", "error"].includes(conversation.status) ? <button className="zen-chat-inline-action" type="button" disabled={busy} onClick={() => void run(CHAT_IPC.resume)}>Resume after checking current state</button> : null}
            {busy ? <button className="zen-chat-inline-action" type="button" onClick={() => void run(CHAT_IPC.takeover)}>Take over browser control</button> : null}
            {attachments.length || contexts.length ? <div className="zen-chat-context-list">
              {contexts.map((context) => <button className="zen-beui-chat-context" type="button" key={context.id} title={context.title} onClick={() => setContexts((items) => items.filter((item) => item.id !== context.id))}><span>{context.title || context.url}</span><X size={12} /></button>)}
              {attachments.map((file) => <button className="zen-beui-chat-context" type="button" key={file.id} title={file.filename} onClick={() => { setAttachments((items) => items.filter((item) => item.id !== file.id)); void invoke(CHAT_IPC.removeAttachment, { conversationId: conversation?.id, attachmentId: file.id }); }}><span>{file.filename}</span><X size={12} /></button>)}
            </div> : null}
            <PromptInput actions={composerActions} className="zen-beui-chat-composer" value={draft} onValueChange={setDraft}
              models={catalog.filter((item) => item.available).map((item) => ({ value: item.id, label: item.name, icon: <MessageCircle aria-hidden="true" size={14} /> }))}
              model={model} onModelChange={setModel} loading={busy} disabled={!conversation || (!enabled && !busy)}
              onStop={() => void run(CHAT_IPC.abort)} onAction={(value) => void action(value)} onSubmit={submit} placeholder="Message the agent…" />
          </div>
        </main>
      </ChatApp>
    </div>
  );
}
