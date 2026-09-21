"use strict";
(async function () {
  const version = "0.3.6";
  try {
    const response = await fetch(document.body.dataset.template + "?v=" + version, {cache: "no-store"});
    if (!response.ok) throw new Error("Не удалось загрузить интерфейс");
    const doc = new DOMParser().parseFromString(await response.text(), "text/html");
    if (doc.querySelector('meta[name="wp-build"]')?.content !== version) throw new Error("Файлы интерфейса разных версий. Загрузите все файлы из архива 0.3.6.");
    doc.querySelectorAll("style").forEach(style => document.head.append(style.cloneNode(true)));
    const scripts = [...doc.body.querySelectorAll("script")];
    scripts.forEach(script => script.remove());
    document.getElementById("page").replaceChildren(...[...doc.body.childNodes].map(node => node.cloneNode(true)));
    scripts.forEach(source => {
      const script = document.createElement("script");
      script.textContent = source.textContent;
      document.body.append(script);
    });
    document.querySelector(".app-version").textContent = "Интерфейс v" + version;
  } catch (error) {
    document.getElementById("loadError").textContent = error.message;
    document.getElementById("loadError").style.display = "block";
  }
})();
