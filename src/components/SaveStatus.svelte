<script lang="ts">
  import type { SaveState } from "../lib/autosave";

  /**
   * حالة الحفظ — `Luma.md` §٨ و`IMPLEMENTATION.md` §٥ **ثابت**.
   *
   * «موجودة لبناء الثقة عند الحاجة، وشبه غير محسوسة في الظروف
   * الطبيعية.» لا زر، ولا إجراء، ولا شريط سفلي دائم.
   *
   * **لا معنى يُنقل باللون وحده:** كل حالة تحمل أيقونة ونصًّا معًا
   * — §٩ و§١٧ مبدأ ٩.
   */
  let { state }: { state: SaveState } = $props();

  const label = $derived(
    state.kind === "saving"
      ? "جارٍ الحفظ"
      : state.kind === "saved"
        ? "محفوظ"
        : state.kind === "failed"
          ? "تعذّر الحفظ"
          : "",
  );
</script>

<!--
  `aria-live="polite"` يُعلن الحالة **من دون سحب التركيز من النص**
  — §١٣ **ثابت**.
-->
<div
  class="status"
  class:saving={state.kind === "saving"}
  class:failed={state.kind === "failed"}
  aria-live="polite"
  aria-atomic="true"
>
  {#if state.kind === "saving"}
    <svg class="icon spin" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor"
        stroke-width="1.4" stroke-dasharray="28" stroke-dashoffset="9" />
    </svg>
    <span>{label}</span>
  {:else if state.kind === "saved"}
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-6" fill="none" stroke="currentColor"
        stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    <span>{label}</span>
  {:else if state.kind === "failed"}
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2.5l6 11H2l6-11z" fill="none" stroke="currentColor"
        stroke-width="1.4" stroke-linejoin="round" />
      <path d="M8 6.5v3.2" stroke="currentColor" stroke-width="1.4"
        stroke-linecap="round" />
      <circle cx="8" cy="11.6" r="0.8" fill="currentColor" />
    </svg>
    <span>{label}</span>
  {/if}
</div>

<style>
  .status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-muted);
    /* الحالة المستقرة خافتة: لا تطلب انتباهًا في الظروف الطبيعية */
    transition: opacity 200ms ease;
  }

  .status.saving {
    color: var(--text-secondary);
  }

  /* تعذّر الحفظ وحده يرفع البروز — ومعه أيقونة ونص، لا لون وحده */
  .status.failed {
    color: var(--state-critical, #a3341f);
  }

  .icon {
    width: 16px;
    height: 16px;
    flex: none;
  }

  .spin {
    animation: spin 900ms linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* تقليل الحركة: يوقف نبض مؤشر الحفظ بلا فقد وظيفة — §١٣ **ثابت** */
  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
    }
  }
</style>
