<script lang="ts">
  import { ICONS, type IconDef, type IconName } from "./icons";

  /**
   * أيقونة ١٦×١٦ بلون موروث.
   *
   * التسمية الوصفية إلزامية: إما `label` تصل قارئ الشاشة، أو
   * `decorative` عندما يكون النص المجاور هو التسمية — §٩ **ثابت**:
   * «لا تُستخدم أيقونة بلا تسمية أو aria-label».
   */
  let {
    name,
    label,
    decorative = false,
    size = 16,
  }: {
    name: IconName;
    label?: string;
    decorative?: boolean;
    size?: number;
  } = $props();

  // مُوسَّع إلى `IconDef`: `as const` يجعل كل مدخل نوعًا حرفيًّا،
  // فالحقول الاختيارية (`fill`) لا تظهر على من أغفلها.
  const def: IconDef = $derived(ICONS[name]);
  const accessibleName = $derived(label ?? def.label);
</script>

<svg
  width={size}
  height={size}
  viewBox={def.viewBox}
  fill="none"
  role={decorative ? "presentation" : "img"}
  aria-hidden={decorative ? "true" : undefined}
  aria-label={decorative ? undefined : accessibleName}
>
  <!--
    علامةٌ مملوءة أو مرسومة بالحدّ. أكثر أيقونات Luma خطّية بحدٍّ ١٫٤،
    وبعض العلامات الرسمية (GitHub) لا توجد إلا مملوءة — ورسمُها بالحدّ
    تقليدٌ رديء لها.
  -->
  {#if def.fill}
    <path d={def.path} fill="currentColor" />
  {:else}
    <path
      d={def.path}
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap={def.round ? "round" : "butt"}
      stroke-linejoin={def.round ? "round" : "miter"}
    />
  {/if}
</svg>

<style>
  svg {
    display: block;
    flex: none;
  }
</style>
