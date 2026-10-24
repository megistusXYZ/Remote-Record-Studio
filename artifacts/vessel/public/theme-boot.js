// Applies the saved theme before the app paints, so the page never flashes
// the wrong colours. Loaded from <head> in index.html; src/lib/theme.ts owns
// the same rules once the app is running.
(function () {
  var theme = "dark";
  try {
    var saved = localStorage.getItem("vessel_theme");
    if (saved === "light" || saved === "dark") {
      theme = saved;
    } else {
      var dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      theme = dark ? "dark" : "light";
    }
  } catch (e) {}
  var root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  root.classList.toggle("dark", theme === "dark");
})();
