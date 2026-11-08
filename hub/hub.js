// Render the Operations Desk as the featured tool and other registry entries below.

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
  const featured = tools.find(tool => tool.id === "operations-desk");
  const others = tools.filter(tool => tool.id !== "operations-desk");
  if (featured) {
    const slot = document.getElementById("featured-tool");
    const link = document.createElement("a");
    link.className = "featured-desk";
    link.href = featured.route;
    const content = document.createElement("span");
    content.className = "featured-content";
    const eyebrow = document.createElement("span");
    eyebrow.className = "featured-eyebrow";
    eyebrow.textContent = "PROJECTS & KNOWLEDGE";
    const name = document.createElement("span");
    name.className = "featured-name";
    name.textContent = featured.name;
    const description = document.createElement("span");
    description.className = "featured-description";
    description.textContent = "Explore your repositories, workflows, and connected knowledge in one place.";
    const action = document.createElement("span");
    action.className = "featured-action";
    action.textContent = "Open desk →";
    const artwork = document.createElement("img");
    artwork.className = "featured-art";
    artwork.src = "/hub/tools/operations-desk/feature.svg";
    artwork.alt = "";
    artwork.setAttribute("aria-hidden", "true");
    content.append(eyebrow, name, description, action);
    link.append(content, artwork);
    slot.append(link);
    slot.hidden = false;
  }
  document.getElementById("tools-heading").hidden = !featured || !others.length;
  list.append(...(featured ? others : tools).map(tile));
} catch {
  document.getElementById("tiles-error").hidden = false;
}
