import "./app.css";
import "./editor.css";
import { mount } from "svelte";
import App from "./App.svelte";

const target = document.getElementById("luma");
if (!target) throw new Error("جذر التطبيق غير موجود");

export default mount(App, { target });
