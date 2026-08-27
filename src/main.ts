import "./app.css";
import "./editor.css";
import { mount } from "svelte";
import App from "./App.svelte";
import { installPrintThemeGuard } from "./lib/print";

const target = document.getElementById("luma");
if (!target) throw new Error("جذر التطبيق غير موجود");

// الورق أبيض دائمًا عند الطباعة، بصرف النظر عن ثيم الشاشة — الشرح في
// `lib/print.ts`. يعيش طوال عمر التطبيق فلا حاجة لفكّ الربط.
installPrintThemeGuard(document.documentElement, window);

export default mount(App, { target });
