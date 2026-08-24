<script lang="ts">
  /**
   * حقل نص — ثماني حالات (`100:111`).
   * **نطاقه اسم المستند والبحث فقط** — لا حقول حساب ولا تسجيل دخول (§١٢).
   */
  let {
    value = $bindable(""), label, placeholder = "", state = "normal",
    message = "", readonly = false, disabled = false, id = crypto.randomUUID(),
  }: {
    value?: string; label: string; placeholder?: string;
    state?: "normal" | "error" | "success"; message?: string;
    readonly?: boolean; disabled?: boolean; id?: string;
  } = $props();
</script>

<div class="wrap">
  <label class="label" for={id}>{label}</label>
  <input
    {id} type="text" bind:value {placeholder} {readonly} {disabled}
    class={state}
    aria-invalid={state === "error" ? "true" : undefined}
    aria-describedby={message ? `${id}-msg` : undefined}
  />
  {#if message}
    <!-- الرسالة نص، فالحالة لا تُنقل باللون وحده -->
    <span id="{id}-msg" class="msg {state}">{message}</span>
  {/if}
</div>

<style>
  .wrap { display: flex; flex-direction: column; gap: var(--space-004); }
  .label { font: var(--text-ui-10); letter-spacing: 0; color: var(--text-secondary); }
  input {
    font: var(--text-ui-07); letter-spacing: 0;
    color: var(--text-primary);
    background: var(--surface-paper);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-sm);
    min-block-size: var(--size-btn-md);
    padding-inline: var(--space-012);
    transition: border-color 120ms ease;
  }
  input::placeholder { color: var(--text-muted); }
  input:hover:not(:disabled):not([readonly]) { border-color: var(--text-muted); }
  input:focus-visible {
    outline: var(--size-focus-ring) solid var(--accent-graphic);
    outline-offset: var(--size-focus-offset);
    border-color: var(--accent-graphic);
  }
  input.error { border-color: var(--state-critical); }
  input.success { border-color: var(--state-positive); }
  input[readonly] { background: var(--surface-sunken); color: var(--text-secondary); }
  input:disabled { opacity: 0.45; cursor: default; }

  .msg { font: var(--text-ui-09); letter-spacing: 0; color: var(--text-muted); }
  .msg.error { color: var(--state-critical); }
  .msg.success { color: var(--state-positive); }
  @media (prefers-reduced-motion: reduce) { input { transition: none; } }
</style>
