// herdra: Herdr's own copy of the toast mod, plus one change (task-76): an agent alert (needs you /
// finished) is not drawn, because the alerts mod already posts it to Hokum. Everything else
// (errors, failed commands, script exits) shows as before. Installed by herdr-app/toast/install.
//
// How notifications look. Anything can post one with notify({ title, body,
// level, icon, action }); replace this mod to restyle them all. Click to
// run its action (e.g. go to the agent) and dismiss it.

import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, run, theme, terminals } from "herdr";

const DOT = { error: "blocked", warning: "working", success: "done", info: "accent" };

// Herdr posts its agent alerts with the action agent.focus {terminal}. Sub-agents (a terminal with a
// parent) are not mirrored to Hokum, so theirs still show here.
function agentAlert(p) {
  if (p.action?.name !== "agent.focus") return false;
  return !terminals().find((t) => t.address === p.action.args?.terminal)?.parent;
}

export default class Toast extends View {
  init(_props, _cx) {
    const p = props() ?? {};
    if (agentAlert(p)) closeOverlay(p.overlay);
  }

  render(cx) {
    const t = theme();
    const p = props() ?? {};
    return h_flex()
      .id("toast")
      .size_full()
      .px(18)
      .gap(12)
      .items_center()
      .bg(t.popover)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => {
        if (p.action?.name) run(p.action.name, p.action.args ?? {});
        closeOverlay(p.overlay);
      })
      .child(p.icon ? image(p.icon).w(18).h(18).flex_none() : div().size(8).rounded(4).flex_none().bg(t[DOT[p.level] ?? "accent"]))
      .child(
        v_flex()
          .flex_1()
          .overflow_hidden()
          .child(div().truncate().font_semibold().text_size(13).text_color(t.foreground).child(p.title ?? ""))
          .when(Boolean(p.body), (el) => el.child(div().truncate().text_size(12).text_color(t.muted).child(p.body ?? ""))),
      );
  }
}
