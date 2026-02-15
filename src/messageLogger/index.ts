import type { ExtensionWebExports } from "@moonlight-mod/types";

const EXT_ID = "messageLogger";

function getSetting<T>(name: string): T | undefined {
  return moonlight.getConfigOption<T>(EXT_ID, name);
}

const ML_REQ = 'require("messageLogger_main")';

export const patches: ExtensionWebExports["patches"] = [
  {
    find: '"MessageStore"',
    replace: [
      {
        match: /function (?=.+?MESSAGE_DELETE:(\i))\1\((\i)\)\{let.+?((?:\i\.){2})getOrCreate.+?\}(?=function)/,
        replacement: (_: string, n: string, p: string, pre: string) =>
          `function ${n}(${p}){` +
          `var cache=${pre}getOrCreate(${p}.channelId);` +
          `var ml=${ML_REQ};` +
          `cache=ml.handleDelete(cache,${p},false);` +
          `${pre}commit(cache);` +
          `}`
      },
      {
        match: /function (?=.+?MESSAGE_DELETE_BULK:(\i))\1\((\i)\)\{let.+?((?:\i\.){2})getOrCreate.+?\}(?=function)/,
        replacement: (_: string, n: string, p: string, pre: string) =>
          `function ${n}(${p}){` +
          `var cache=${pre}getOrCreate(${p}.channelId);` +
          `var ml=${ML_REQ};` +
          `cache=ml.handleDelete(cache,${p},true);` +
          `${pre}commit(cache);` +
          `}`
      },
      {
        match: /(function (\i)\((\i)\).+?)\.update\((\i)(?=.*MESSAGE_UPDATE:\2)/,
        replacement: (_: string, lead: string, _name: string, ev: string, id: string) =>
          `${lead}.update(${id},m=>{` +
          `var ml=${ML_REQ};` +
          `if((${ev}.message.flags&64)===64||(ml.shouldIgnore(${ev}.message,true)))return m;` +
          `if(!${ev}.message.edited_timestamp||${ev}.message.content===m.content)return m;` +
          `return m.set('editHistory',[...(m.editHistory||[]),ml.makeEdit(${ev}.message,m)]);` +
          `}).update(${id}`
      },
      {
        match: /(?<=getLastEditableMessage\(\i\)\{.{0,200}\.find\((\i)=>)/,
        replacement: "!$1.deleted&&"
      }
    ]
  },
  {
    find: "}addReaction(",
    replace: {
      match: /this\.customRenderedContent=(\i)\.customRenderedContent,/,
      replacement:
        "this.customRenderedContent=$1.customRenderedContent," +
        "this.deleted=$1.deleted||false," +
        "this.editHistory=$1.editHistory||[]," +
        "this.firstEditTimestamp=$1.firstEditTimestamp||this.editedTimestamp||this.timestamp," +
        "this.diffViewDisabled=$1.diffViewDisabled||false,"
    }
  },
  {
    find: ".PREMIUM_REFERRAL&&(",
    replace: [
      {
        match: /(?<=null!=\i\.edited_timestamp\)return )\i\(\i,\{reactions:(\i)\.reactions.{0,50}\}\)/,
        replacement: (m: string, v: string) =>
          `Object.assign(${m},{deleted:${v}.deleted,editHistory:${v}.editHistory,firstEditTimestamp:${v}.firstEditTimestamp,diffViewDisabled:${v}.diffViewDisabled})`
      },
      {
        match: /attachments:(\i)\((\i)\)/,
        replacement: (_: string, parseFn: string, msg: string) =>
          `attachments:${parseFn}((()=>{` +
          `var ml=${ML_REQ};` +
          `if(ml.shouldIgnore(${msg}))return ${msg};` +
          `var old=arguments[1]?.attachments;` +
          `if(!old)return ${msg};` +
          `var new_=${msg}.attachments?.map(function(a){return a.id})??[];` +
          `var diff=old.filter(function(a){return!new_.includes(a.id)});` +
          `old.forEach(function(a){a.deleted=true});` +
          `${msg}.attachments=[...diff,...${msg}.attachments];` +
          `return ${msg};` +
          `})()),` +
          `deleted:arguments[1]?.deleted,` +
          `editHistory:arguments[1]?.editHistory,` +
          `firstEditTimestamp:new Date(arguments[1]?.firstEditTimestamp??${msg}.editedTimestamp??${msg}.timestamp),` +
          `diffViewDisabled:arguments[1]?.diffViewDisabled`
      },
      {
        match: /(\((\i)\)\{return null==\2\.attachments.+?)spoiler:/,
        replacement: "$1deleted:arguments[0]?.deleted,spoiler:"
      }
    ]
  },
  {
    find: "#{intl::REMOVE_ATTACHMENT_TOOLTIP_TEXT}",
    replace: {
      match: /\.SPOILER,(?=\[\i\.\i\]:)/,
      replacement: '$&"messagelogger-deleted-attachment":arguments[0]?.item?.originalItem?.deleted,'
    }
  },
  {
    find: "Message must not be a thread starter message",
    replace: {
      match: /\)\("li",\{(.+?),className:/,
      replacement: (m: string, inner: string) =>
        ')("li",{' + inner + ',className:(arguments[0].message.deleted?"messagelogger-deleted ":"")+'
    }
  },
  {
    find: ".SEND_FAILED,",
    replace: {
      match: /\]:\i\.isUnsupported.{0,20}?,children:\[/,
      replacement: `$&arguments[0]?.message?.editHistory?.length>0&&(${ML_REQ}).renderEdits(arguments[0]),`
    }
  },
  {
    find: "#{intl::MESSAGE_EDITED}",
    replace: {
      match: /(isInline:!1,children:.{0,50}?)"span",\{(?=className:)/,
      replacement: `$1(${ML_REQ}).EditMarker,{message:arguments[0].message,`
    }
  },
  {
    find: '"ReferencedMessageStore"',
    replace: [
      { match: /MESSAGE_DELETE:\i,/, replacement: "MESSAGE_DELETE:()=>{}," },
      { match: /MESSAGE_DELETE_BULK:\i,/, replacement: "MESSAGE_DELETE_BULK:()=>{}," }
    ]
  },
  {
    find: ".MESSAGE,commandTargetId:",
    replace: {
      match: /children:(\[""===.+?\])/,
      replacement: `children:(arguments[0].message.deleted?[]:$1).concat((${ML_REQ}).getMessageContextMenuItems(arguments[0])||[])`
    }
  },
  {
    find: "NON_COLLAPSIBLE.has(",
    prerequisite: () => getSetting<boolean>("collapseDeleted") ?? false,
    replace: {
      match: /if\((\i)\.blocked\)return \i\.\i\.MESSAGE_GROUP_BLOCKED;/,
      replacement: '$&else if($1.deleted)return"MESSAGE_GROUP_DELETED";'
    }
  },
  {
    find: "#{intl::NEW_MESSAGES_ESTIMATED_WITH_DATE}",
    prerequisite: () => getSetting<boolean>("collapseDeleted") ?? false,
    replace: [
      {
        match: /(\i)\.type===\i\.\i\.MESSAGE_GROUP_BLOCKED\|\|/,
        replacement: '$1.type==="MESSAGE_GROUP_DELETED"||'
      },
      {
        match: /(\i)\.type===\i\.\i\.MESSAGE_GROUP_BLOCKED\?.*?:/,
        replacement: `$1.type==="MESSAGE_GROUP_DELETED"?(${ML_REQ}).DELETED_MESSAGE_COUNT():`
      }
    ]
  }
];

export const webpackModules: ExtensionWebExports["webpackModules"] = {
  diffUtils: {
    dependencies: []
  },
  main: {
    entrypoint: true,
    dependencies: [
      { id: "discord/Dispatcher" },
      { id: "react" },
      { ext: "spacepack", id: "spacepack" },
      { ext: "contextMenu", id: "contextMenu" }
    ]
  }
};

export const styles: ExtensionWebExports["styles"] = ["./style.css"];
