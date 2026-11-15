const missionView = document.getElementById("mission-view");
const demView = document.getElementById("dem-view");
const missionPanel = document.getElementById("mission-panel");
const demPanel = document.getElementById("dem-panel");

const atlasTabs = [missionView, demView, dataTab];
function showView(index) {
  [missionPanel, demPanel, dataPanel].forEach((panel, i) => panel.hidden = i !== index);
  document.getElementById("export").hidden = index !== 0;
  atlasTabs.forEach((tab, i) => {
    tab.setAttribute("aria-selected", String(i === index));
    tab.tabIndex = i === index ? 0 : -1;
  });
  if (index === 2) refreshData();
}

atlasTabs.forEach((tab, index) => tab.onclick = () => showView(index));
missionView.parentElement.addEventListener("keydown", event => {
  const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
  if (!keys.includes(event.key)) return;
  event.preventDefault();
  const current = atlasTabs.indexOf(event.target);
  const index = event.key === "Home" ? 0 : event.key === "End" ? 2 :
    (current + (event.key === "ArrowRight" ? 1 : 2)) % 3;
  showView(index);
  atlasTabs[index].focus();
});
document.querySelector(".rail-button.active").onclick = () => showView(0);
showView(location.hash === "#files-panel" ? 2 : location.hash === "#dem-panel" ? 1 : 0);
