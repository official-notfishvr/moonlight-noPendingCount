import React from "@moonlight-mod/wp/react";
import Dispatcher from "@moonlight-mod/wp/discord/Dispatcher";
import { createMessageDiff, DiffPart } from "@moonlight-mod/wp/messageLogger_diffUtils";
import spacepack from "@moonlight-mod/wp/spacepack_spacepack";
import contextMenu from "@moonlight-mod/wp/contextMenu_contextMenu";

const EXT_ID = "messageLogger";

function getSetting<T>(name: string, fallback: T): T {
  const val = moonlight.getConfigOption<T>(EXT_ID, name);
  return val !== undefined ? val : fallback;
}

function applyDeleteStyle() {
  const style = getSetting<string>("deleteStyle", "text");
  document.body.setAttribute("data-ml-delete-style", style);
}

applyDeleteStyle();

function formatTimestamp(ts: Date | string | number): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  return d.toLocaleString();
}

export function shouldIgnore(message: any, isEdit: boolean = false): boolean {
  try {
    const ignoreBots = getSetting<boolean>("ignoreBots", false);
    const ignoreSelf = getSetting<boolean>("ignoreSelf", false);
    const ignoreUsersStr = getSetting<string>("ignoreUsers", "");
    const ignoreChannelsStr = getSetting<string>("ignoreChannels", "");
    const ignoreGuildsStr = getSetting<string>("ignoreGuilds", "");
    const logEdits = getSetting<boolean>("logEdits", true);
    const logDeletes = getSetting<boolean>("logDeletes", true);

    const ignoreUsers = ignoreUsersStr
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const ignoreChannels = ignoreChannelsStr
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const ignoreGuilds = ignoreGuildsStr
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    let currentUserId = "";
    try {
      const UserStore = spacepack.findByCode('"UserStore"')[0].exports;
      const user = UserStore?.getCurrentUser?.();
      if (user) currentUserId = user.id;
    } catch (_) {}

    if (ignoreBots && message.author?.bot) return true;
    if (ignoreSelf && message.author?.id === currentUserId) return true;
    if (ignoreUsers.includes(message.author?.id)) return true;
    if (ignoreChannels.includes(message.channel_id)) return true;

    try {
      const ChannelStore = spacepack.findByCode('"ChannelStore"')[0].exports;
      const channel = ChannelStore?.getChannel?.(message.channel_id);
      if (channel) {
        if (ignoreChannels.includes(channel.parent_id)) return true;
        if (ignoreGuilds.includes(channel.guild_id)) return true;
      }
    } catch (_) {}

    if (isEdit && !logEdits) return true;
    if (!isEdit && !logDeletes) return true;

    return false;
  } catch (_) {
    return false;
  }
}

export function handleDelete(
  cache: any,
  data: { ids?: string[]; id?: string; channelId?: string; mlDeleted?: boolean },
  isBulk: boolean
): any {
  try {
    if (cache == null) return cache;
    if (!isBulk && data.id && !cache.has(data.id)) return cache;

    const mutate = (id: string) => {
      const msg = cache.get(id);
      if (!msg) return;

      const EPHEMERAL = 64;
      const skip = data.mlDeleted || (msg.flags & EPHEMERAL) === EPHEMERAL || shouldIgnore(msg);

      if (skip) {
        cache = cache.remove(id);
      } else {
        cache = cache.update(id, (m: any) =>
          m.set("deleted", true).set(
            "attachments",
            m.attachments.map((a: any) => {
              a.deleted = true;
              return a;
            })
          )
        );
        console.log("[MessageLogger] Deleted message preserved:", id, "channel:", data.channelId || "(unknown)");
      }
    };

    if (isBulk && data.ids) {
      data.ids.forEach(mutate);
    } else if (data.id) {
      mutate(data.id);
    }
  } catch (e) {
    console.error("[MessageLogger] Error in handleDelete:", e);
  }
  return cache;
}

export function makeEdit(
  newMessage: { edited_timestamp: string },
  oldMessage: { content: string }
): { timestamp: Date; content: string } {
  console.log("[MessageLogger] Edit recorded, old content:", oldMessage.content);
  return {
    timestamp: new Date(newMessage.edited_timestamp),
    content: oldMessage.content
  };
}

function createDiffElement(part: DiffPart, key: React.Key): React.ReactElement {
  let className: string | undefined = undefined;
  if (part.type === "added") {
    className = "messagelogger-diff-added";
  } else if (part.type === "removed") {
    className = "messagelogger-diff-removed";
  }
  return React.createElement("span", { key, className }, part.text);
}

function renderDiffElements(diffParts: DiffPart[]): React.ReactElement[] {
  return diffParts.map((part, index) => createDiffElement(part, index));
}

export function parseEditContent(
  content: string,
  message: { id: string; channel_id: string; content?: string },
  previousContent?: string
): React.ReactNode {
  const showDiffs = getSetting<boolean>("showEditDiffs", true);

  if (previousContent && content !== previousContent && showDiffs) {
    const diffParts = createMessageDiff(content, previousContent);
    return React.createElement("span", null, ...renderDiffElements(diffParts));
  }

  return React.createElement("span", null, content);
}

export function renderEdits(props: { message: any }): React.ReactNode {
  try {
    const msg = props.message;
    if (!msg || !msg.editHistory || msg.editHistory.length === 0) return null;

    const inlineEdits = getSetting<boolean>("inlineEdits", true);
    if (!inlineEdits) return null;

    const history: Array<{ timestamp: Date; content: string }> = msg.editHistory;

    const elements = history.map((edit: { timestamp: Date; content: string }, idx: number) => {
      const nextContent = idx === history.length - 1 ? msg.content : history[idx + 1]?.content;

      const parsed = parseEditContent(edit.content, msg, nextContent);
      const ts = formatTimestamp(edit.timestamp);

      return React.createElement(
        "div",
        { key: "ml-edit-" + idx, className: "messagelogger-edited" },
        parsed,
        React.createElement(
          "span",
          {
            className: "messagelogger-history-timestamp",
            style: { fontSize: "0.625rem", color: "var(--text-muted)", marginLeft: "4px" }
          },
          "(edited ",
          ts,
          ")"
        )
      );
    });

    return React.createElement("div", { key: "ml-edit-history-" + msg.id }, ...elements);
  } catch (e) {
    console.error("[MessageLogger] Error rendering edits:", e);
    return null;
  }
}

export function EditMarker(props: {
  message: any;
  className?: string;
  children?: React.ReactNode;
  [key: string]: any;
}): React.ReactElement {
  const { message, className, children, ...rest } = props;
  const classes = ["messagelogger-edit-marker"];
  if (className) classes.push(className);

  return React.createElement(
    "span",
    {
      ...rest,
      className: classes.join(" "),
      onClick: () => openHistoryModal(message),
      role: "button"
    },
    children
  );
}

export function openHistoryModal(message: any): void {
  if (!message || !message.editHistory || message.editHistory.length === 0) {
    console.log("[MessageLogger] No edit history available for this message.");
    return;
  }

  const history = message.editHistory;
  let logOutput = "[MessageLogger] Edit History for message " + message.id + ":\n";
  const firstTs = message.firstEditTimestamp || message.editedTimestamp || message.timestamp;
  logOutput += "  Original at " + formatTimestamp(firstTs) + "\n";
  history.forEach((edit: any, idx: number) => {
    logOutput += "  Version " + (idx + 1) + " at " + formatTimestamp(edit.timestamp) + ": " + edit.content + "\n";
  });
  logOutput += "  Current: " + message.content;
  console.log(logOutput);

  const notice = document.createElement("div");
  notice.style.cssText =
    "position:fixed;top:60px;right:20px;z-index:99999;" +
    "background:var(--background-floating, #18191c);" +
    "color:var(--text-normal, #dcddde);" +
    "padding:12px 16px;border-radius:8px;font-size:14px;" +
    "box-shadow:0 4px 12px rgba(0,0,0,0.3);max-width:400px;" +
    "border:1px solid var(--background-modifier-accent, #40444b);";
  notice.textContent = "Edit history logged to console (Ctrl+Shift+I). " + history.length + " edit(s) recorded.";
  document.body.appendChild(notice);
  setTimeout(() => notice.remove(), 4000);
}

export const DELETED_MESSAGE_COUNT = () => ({
  ast: [
    [
      6,
      "count",
      {
        "=0": ["No deleted messages"],
        one: [[1, "count"], " deleted message"],
        other: [[1, "count"], " deleted messages"]
      },
      0,
      "cardinal"
    ]
  ]
});

export function getMessageContextMenuItems(props: { message: any }): React.ReactElement[] | null {
  try {
    const msg = props.message;
    if (!msg) return null;
    if (!msg.deleted && (!msg.editHistory || msg.editHistory.length === 0)) return null;

    const items: React.ReactElement[] = [];

    if (msg.deleted) {
      items.push(
        React.createElement(contextMenu.MenuItem, {
          id: "ml-toggle-delete-style",
          key: "ml-toggle-delete-style",
          label: "Hide Delete Highlight",
          action: () => {
            const el = document.getElementById("chat-messages-" + msg.channel_id + "-" + msg.id);
            if (el) {
              el.classList.remove("messagelogger-deleted");
            }
          }
        })
      );

      items.push(
        React.createElement(contextMenu.MenuItem, {
          id: "ml-remove-message",
          key: "ml-remove-message",
          label: "Remove Deleted Message",
          color: "danger",
          action: () => {
            Dispatcher.dispatch({
              type: "MESSAGE_DELETE",
              channelId: msg.channel_id,
              id: msg.id,
              mlDeleted: true
            });
          }
        })
      );
    }

    if (msg.editHistory && msg.editHistory.length > 0) {
      items.push(
        React.createElement(contextMenu.MenuItem, {
          id: "ml-view-history",
          key: "ml-view-history",
          label: "View Edit History (" + msg.editHistory.length + ")",
          action: () => {
            openHistoryModal(msg);
          }
        })
      );

      items.push(
        React.createElement(contextMenu.MenuItem, {
          id: "ml-clear-edits",
          key: "ml-clear-edits",
          label: "Clear Edit History",
          color: "danger",
          action: () => {
            msg.editHistory = [];
          }
        })
      );
    }

    return items.length > 0 ? items : null;
  } catch (e) {
    console.error("[MessageLogger] Error creating context menu items:", e);
    return null;
  }
}

contextMenu.addItem(
  "message",
  (props: any) => {
    const msg = props?.message;
    if (!msg) return null;
    if (!msg.deleted && (!msg.editHistory || msg.editHistory.length === 0)) return null;

    const items: React.ReactElement[] = [];

    if (msg.deleted) {
      items.push(
        React.createElement(contextMenu.MenuItem, {
          id: "ml-ctx-toggle-delete",
          key: "ml-ctx-toggle-delete",
          label: "Hide Delete Highlight",
          action: () => {
            const el = document.getElementById("chat-messages-" + msg.channel_id + "-" + msg.id);
            if (el) el.classList.remove("messagelogger-deleted");
          }
        })
      );
      items.push(
        React.createElement(contextMenu.MenuItem, {
          id: "ml-ctx-remove-message",
          key: "ml-ctx-remove-message",
          label: "Remove Deleted Message",
          color: "danger",
          action: () => {
            Dispatcher.dispatch({
              type: "MESSAGE_DELETE",
              channelId: msg.channel_id,
              id: msg.id,
              mlDeleted: true
            });
          }
        })
      );
    }

    if (msg.editHistory && msg.editHistory.length > 0) {
      items.push(
        React.createElement(contextMenu.MenuItem, {
          id: "ml-ctx-view-history",
          key: "ml-ctx-view-history",
          label: "View Edit History (" + msg.editHistory.length + ")",
          action: () => openHistoryModal(msg)
        })
      );
      items.push(
        React.createElement(contextMenu.MenuItem, {
          id: "ml-ctx-clear-edits",
          key: "ml-ctx-clear-edits",
          label: "Clear Edit History",
          color: "danger",
          action: () => {
            msg.editHistory = [];
          }
        })
      );
    }

    if (items.length === 0) return null;

    return React.createElement(contextMenu.MenuGroup, { key: "ml-ctx-group" }, ...items);
  },
  "copy-id"
);

console.log("[MessageLogger] Extension loaded. Delete style:", getSetting<string>("deleteStyle", "text"));
