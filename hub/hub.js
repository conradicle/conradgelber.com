// Draws one tile per entry in /hub/tools.json. Adding a tool never touches
// this file; see ADDING_TOOLS.md.

const list = document.getElementById("tiles");

function tile(tool) {
  const li = document.createElement("li");
  const a = document.createElement("a");
  a.className = "tile";
  a.href = tool.route;
  if (tool.icon) {
    const img = document.createElement("img");
    img.src = tool.icon;
    img.alt = "";
    img.width = 40;
    img.height = 40;
    a.append(img);
  }
  const text = document.createElement("span");
  const name = document.createElement("span");
  name.className = "tile-name";
  name.textContent = tool.name;
  const desc = document.createElement("span");
  desc.className = "tile-desc";
  desc.textContent = tool.description || "";
  text.append(name, desc);
  a.append(text);
  li.append(a);
  return li;
}

try {
  const res = await fetch("/hub/tools.json", { cache: "no-store" });
  if (res.status === 401 || res.redirected) location.href = "/login/";
  const { tools } = await res.json();
  list.append(...tools.map(tile));
} catch {
  document.getElementById("tiles-error").hidden = false;
}
