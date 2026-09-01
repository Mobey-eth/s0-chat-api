const tabs = document.querySelectorAll("[data-tab]");
const panels = document.querySelectorAll("[data-panel]");

for (const tab of tabs) {
  tab.addEventListener("click", () => {
    for (const item of tabs) item.classList.toggle("active", item === tab);
    for (const panel of panels) {
      panel.classList.toggle("active", panel.dataset.panel === tab.dataset.tab);
    }
  });
}

for (const button of document.querySelectorAll("[data-copy]")) {
  button.addEventListener("click", async () => {
    const target = document.getElementById(button.dataset.copy);
    if (!target) return;
    await navigator.clipboard.writeText(target.innerText);
    const previous = button.textContent;
    button.textContent = "Copied";
    window.setTimeout(() => { button.textContent = previous; }, 1_400);
  });
}
