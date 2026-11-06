// Stable component updates: no work for unchanged signatures, preserve focus/scroll.
const signatures = new WeakMap();
export function text(element, value) {
  const next = String(value ?? "");
  if (element.textContent !== next) element.textContent = next;
}
export function patchHTML(element, html) {
  if (signatures.get(element) === html) return false;
  const scroll = { top: element.scrollTop, left: element.scrollLeft },
    active = element.contains(document.activeElement)
      ? document.activeElement
      : null,
    key =
      active?.dataset?.zpOption ??
      active?.dataset?.zpControl ??
      active?.dataset?.zpCard;
  element.innerHTML = html;
  signatures.set(element, html);
  element.scrollTop = scroll.top;
  element.scrollLeft = scroll.left;
  if (key !== undefined)
    [
      ...element.querySelectorAll(
        "[data-zp-option],[data-zp-control],[data-zp-card]",
      ),
    ]
      .find((e) =>
        [e.dataset.zpOption, e.dataset.zpControl, e.dataset.zpCard].includes(
          key,
        ),
      )
      ?.focus({ preventScroll: true });
  return true;
}
export function position(element, r) {
  if (!element || !r) return;
  const key = [r.x, r.y, r.width, r.height].join(":");
  if (element.dataset.rect === key) return;
  element.dataset.rect = key;
  Object.assign(element.style, {
    left: r.x + "px",
    top: r.y + "px",
    width: r.width + "px",
    height: r.height + "px",
    right: "auto",
    bottom: "auto",
  });
}
export function setCardSize(element, size) {
  if (!element) return;
  for (const [k, v] of Object.entries({
    "--card-width": size.width + "px",
    "--card-height": size.height + "px",
    "--card-step": size.step + "px",
  }))
    element.style.setProperty(k, v);
}
