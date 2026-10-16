function triggerMatch(trigger, event) {
  if (["firstMessage", "newContact"].includes(trigger.type))
    return (
      trigger.enabled !== false &&
      event.type === "message" &&
      !!event[trigger.type]
    );
  if (
    trigger.enabled === false ||
    (trigger.type !== event.type &&
      !(trigger.type === "keyword" && event.type === "message"))
  )
    return false;
  if (trigger.type === "keyword") {
    const text = String(event.text || "")
        .trim()
        .toLocaleLowerCase("pt-BR"),
      term = String(trigger.value || "")
        .trim()
        .toLocaleLowerCase("pt-BR");
    if (!term) return false;
    return trigger.match === "startsWith"
      ? text.startsWith(term)
      : trigger.match === "contains"
        ? text.includes(term)
        : text === term;
  }
  if (trigger.type === "firstMessage" || trigger.type === "newContact")
    return !!event[trigger.type];
  if (trigger.type === "tagAdded")
    return (event.tags || []).includes(trigger.value);
  return !trigger.value || trigger.value === event.name;
}
module.exports = { triggerMatch };
