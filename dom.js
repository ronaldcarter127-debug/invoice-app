function $id(id) {
  return document.getElementById(id);
}

function getVal(id) {
  const el = $id(id);
  return el ? el.value : "";
}

function setVal(id, value) {
  const el = $id(id);
  if (el) el.value = value;
}

function setHTML(id, html) {
  const el = $id(id);
  if (el) el.innerHTML = html;
}

function addClass(id, className) {
  const el = $id(id);
  if (el) el.classList.add(className);
}

function removeClass(id, className) {
  const el = $id(id);
  if (el) el.classList.remove(className);
}
