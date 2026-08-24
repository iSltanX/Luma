<script lang="ts">
  /**
   * معرض المكونات — أداة تطوير **لا تُشحن**.
   *
   * كل مكوّن × كل حالة، ويُعاين في الثيمات الخمسة بتبديل الثيم.
   * يقابل «قسم التحقق من الثيم الداكن» في Figma (`149:366`): نسخة
   * واحدة من المكونات تُقلب بالوضع، لا نسخ مرسومة يدويًا.
   */
  import { THEMES, type ThemeId } from "../tokens/themes";
  import { theme } from "../lib/theme.svelte";
  import { ICON_NAMES } from "../components/icons";
  import Icon from "../components/Icon.svelte";
  import Button from "../components/Button.svelte";
  import IconButton from "../components/IconButton.svelte";
  import Toggle from "../components/Toggle.svelte";
  import Checkbox from "../components/Checkbox.svelte";
  import Radio from "../components/Radio.svelte";
  import Slider from "../components/Slider.svelte";
  import TextField from "../components/TextField.svelte";
  import Badge from "../components/Badge.svelte";
  import Alert from "../components/Alert.svelte";
  import Toast from "../components/Toast.svelte";
  import SettingsRow from "../components/SettingsRow.svelte";
  import NavRow from "../components/NavRow.svelte";
  import ThemeCard from "../components/ThemeCard.svelte";
  import SaveStatus from "../components/SaveStatus.svelte";
  import SearchField from "../components/SearchField.svelte";
  import DocumentRow from "../components/DocumentRow.svelte";
  import RevisionRow from "../components/RevisionRow.svelte";
  import SurfacesBar from "../components/SurfacesBar.svelte";
  import SelectionToolbar from "../components/SelectionToolbar.svelte";
  import ComfortButton from "../components/ComfortButton.svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import { SURFACES } from "../lib/surfaces";

  let on = $state(true);
  let off = $state(false);
  let mixed = $state(false);
  let pick = $state("a");
  let num = $state(19);
  let txt = $state("في الهدوء");

  const KINDS = ["primary", "secondary", "ghost", "destructive"] as const;

  // زمن مرجعي ثابت: اللقطات المرجعية لا تتغيّر مع مرور الوقت
  const NOW = 1_700_000_000_000;
  const HOUR = 3_600_000;
  const CARD = {
    id: "a", title: "في مديح البطء",
    excerpt: "نعيش في عالم يُمجّد السرعة، كل شيء يجب أن يكون فوريًا…",
    wordCount: 247, updatedAt: NOW - HOUR, lastOpenedAt: NOW - HOUR,
  };
  let surface = $state<string | null>("library");
  let query = $state("");
  let filled = $state("قصيدة الشتاء");
</script>

<div class="gallery" data-gallery>
  <header class="bar">
    <strong class="t-ui-08">معرض المكونات</strong>
    <div class="themes">
      {#each THEMES as t (t.id)}
        <button
          class="chip t-ui-10" class:on={theme.id === t.id}
          data-theme-switch={t.id}
          onclick={() => theme.apply(t.id as ThemeId)}>{t.name}</button
        >
      {/each}
    </div>
  </header>

  <section><h3 class="t-ui-04">الأيقونات — ٢٢</h3>
    <div class="icons">
      {#each ICON_NAMES as n (n)}
        <span class="icell"><Icon name={n} /></span>
      {/each}
    </div>
  </section>

  <section><h3 class="t-ui-04">الأزرار — ٤ أنواع × ٦ حالات</h3>
    {#each KINDS as k (k)}
      <div class="row">
        <Button kind={k}>عادي</Button>
        <Button kind={k}>تمرير</Button>
        <Button kind={k} loading>تحميل</Button>
        <Button kind={k} disabled>معطل</Button>
        <Button kind={k} size="lg">كبير</Button>
        <Button kind={k} size="sm">صغير</Button>
      </div>
    {/each}
    <div class="row">
      <IconButton name="library" label="المكتبة" />
      <IconButton name="history" label="السجل" active />
      <IconButton name="settings" label="الإعدادات" disabled />
    </div>
  </section>

  <section><h3 class="t-ui-04">عناصر التحكم</h3>
    <div class="row">
      <Toggle bind:checked={on} label="مشغّل" />
      <Toggle bind:checked={off} label="متوقف" />
      <Toggle checked={false} label="معطل" disabled />
    </div>
    <div class="row">
      <Checkbox bind:checked={on} label="محدد" />
      <Checkbox bind:checked={off} label="غير محدد" />
      <Checkbox indeterminate={true} bind:checked={mixed} label="جزئي" />
      <Checkbox checked={false} label="معطل" disabled />
    </div>
    <div class="row">
      <Radio bind:group={pick} value="a" label="الأول" />
      <Radio bind:group={pick} value="b" label="الثاني" />
      <Radio group="x" value="c" label="معطل" disabled />
    </div>
    <div class="col narrow">
      <Slider bind:value={num} min={14} max={26} label="حجم النص"
        format={(v) => `${v} نقطة`} />
      <Slider value={50} label="معطل" disabled />
    </div>
  </section>

  <section><h3 class="t-ui-04">الحقول — ٨ حالات</h3>
    <div class="row narrow">
      <TextField bind:value={txt} label="عادي" />
      <TextField value="" label="فارغ" placeholder="بدون عنوان" />
      <TextField value="نص" label="خطأ" state="error" message="تعذّر الحفظ" />
      <TextField value="نص" label="نجاح" state="success" message="محفوظ" />
      <TextField value="للقراءة" label="للقراءة فقط" readonly />
      <TextField value="نص" label="معطل" disabled />
    </div>
  </section>

  <section><h3 class="t-ui-04">الحالة والرسائل</h3>
    <div class="row">
      <SaveStatus state={{ kind: "saving" }} />
      <SaveStatus state={{ kind: "saved", at: 0 }} />
      <SaveStatus state={{ kind: "failed", message: "القرص ممتلئ", attempt: 1 }} />
    </div>
    <div class="row">
      <Badge kind="accent">لمسة</Badge><Badge kind="neutral">محايد</Badge>
      <Badge kind="positive">موجب</Badge><Badge kind="caution">تحذير</Badge>
      <Badge kind="critical">خطأ</Badge>
    </div>
    <div class="col narrow">
      <Alert kind="info" title="معلومة" detail="النصوص تُحفظ تلقائيًا." />
      <Alert kind="success" title="نجاح" detail="استُعيدت النسخة." />
      <Alert kind="caution" title="تنبيه" detail="الخط بلا تغطية عربية كاملة." />
      <Alert kind="critical" title="تعذّر الحفظ" detail="المحتوى محفوظ في الذاكرة." />
    </div>
    <div class="row">
      <Toast kind="neutral" text="أُغلقت اللوحة" />
      <Toast kind="success" text="اكتمل الإملاء" action="تراجع" />
      <Toast kind="critical" text="تعذّر قراءة النسخة" />
    </div>
  </section>

  <!-- مكونات المرحلة ٥ مجمَّعة: لها لقطة مرجعية في الثيمات الخمسة.
       الوعاء ضروري لأن `[data-gallery]` صندوق تمرير بارتفاع النافذة،
       فلقطته لا تتجاوز أول شاشة منه. -->
  <div data-surfaces>
  <section><h3 class="t-ui-04">شريط الأسطح ومداخله — خمسة</h3>
    <div class="row">
      <div class="bars">
        <SurfacesBar entries={SURFACES} active={surface}
          ontoggle={(id) => (surface = surface === id ? null : id)} />
      </div>
    </div>
  </section>

  <section><h3 class="t-ui-04">شريط التحديد — حالتان</h3>
    <div class="row">
      <SelectionToolbar role="body" onrole={() => {}} onquote={() => {}} />
      <SelectionToolbar role="h2" onrole={() => {}} onquote={() => {}} />
    </div>
    <div class="row comfort-cell"><ComfortButton /></div>
  </section>

  <section><h3 class="t-ui-04">صفوف المكتبة والسجل — أربع حالات لكل</h3>
    <div class="row">
      <div class="panel"><div class="panel-body">
        <SearchField bind:value={query} />
        <SearchField bind:value={filled} />
        <DocumentRow doc={CARD} now={NOW} onopen={() => {}} />
        <DocumentRow doc={CARD} now={NOW} current onopen={() => {}} />
      </div></div>
      <div class="panel"><div class="panel-body">
        <RevisionRow label="الآن — النسخة الحالية" detail="آخر ما كُتب"
          wordCount={247} selected onselect={() => {}} />
        <RevisionRow at={NOW - HOUR} now={NOW} detail="زادت ١٧ كلمة"
          wordCount={230} onselect={() => {}} />
        <RevisionRow at={NOW - 26 * HOUR} now={NOW}
          detail="قيد المعاينة — للقراءة فقط"
          wordCount={180} selected onselect={() => {}} />
      </div></div>
      <div class="panel"><div class="panel-body">
        <EmptyState icon="library" title="لا توجد نصوص بعد"
          hint="ابدأ الكتابة وسيظهر النص هنا تلقائيًا." />
      </div></div>
    </div>
  </section>

  </div>

  <section><h3 class="t-ui-04">القوائم والأسطح</h3>
    <div class="row">
      <div class="panel">
        <div class="panel-body">
          <NavRow label="المظهر" icon="appearance" active />
          <NavRow label="الكتابة" icon="document" />
          <SettingsRow label="عداد الكلمات" hint="مخفي افتراضيًا">
            {#snippet control()}<Toggle bind:checked={off} label="" />{/snippet}
          </SettingsRow>
        </div>
      </div>
    </div>
    <div class="row">
      {#each THEMES as t (t.id)}
        <ThemeCard id={t.id as ThemeId} name={t.name}
          selected={theme.id === t.id}
          onselect={(id) => theme.apply(id)} />
      {/each}
    </div>
  </section>
</div>

<style>
  .gallery {
    block-size: 100%; overflow-y: auto;
    background: var(--surface-canvas); color: var(--text-primary);
    padding-block-end: var(--space-096);
  }
  .bar {
    position: sticky; inset-block-start: 0; z-index: 1;
    display: flex; align-items: center; justify-content: space-between;
    gap: var(--space-016); padding: var(--space-012) var(--space-024);
    background: var(--surface-raised);
    border-block-end: 1px solid var(--border-subtle);
  }
  .themes { display: flex; gap: var(--space-008); }
  .chip {
    padding: var(--space-004) var(--space-012); min-block-size: var(--size-btn-sm);
    border-radius: var(--radius-sm); cursor: pointer;
    border: 1px solid var(--border-control);
    background: var(--surface-paper); color: var(--text-primary);
  }
  .chip.on { background: var(--accent-subtle); color: var(--accent-text);
    border-color: var(--accent-graphic); }
  .chip:focus-visible {
    outline: var(--size-focus-ring) solid var(--accent-graphic);
    outline-offset: var(--size-focus-offset);
  }
  section { padding: var(--space-024); border-block-end: 1px solid var(--border-subtle); }
  h3 { margin: 0 0 var(--space-016); color: var(--text-primary); }
  .row { display: flex; flex-wrap: wrap; gap: var(--space-016);
    align-items: center; margin-block-end: var(--space-016); }
  .col { display: flex; flex-direction: column; gap: var(--space-016); }
  .narrow { max-inline-size: 420px; }
  .icons { display: flex; flex-wrap: wrap; gap: var(--space-008); }
  .icell {
    inline-size: var(--size-hit); block-size: var(--size-hit);
    display: flex; align-items: center; justify-content: center;
    background: var(--surface-paper); border-radius: var(--radius-sm);
    border: 1px solid var(--border-subtle); color: var(--text-secondary);
  }
  .panel {
    inline-size: var(--size-panel); background: var(--surface-paper);
    border: 1px solid var(--border-subtle); border-radius: var(--radius-md);
    overflow: hidden;
  }
  .panel-body { padding: var(--space-008); display: flex;
    flex-direction: column; gap: var(--space-008); }
  .bars { inline-size: 520px; background: var(--surface-canvas); }
  /* الزر عائم في الإطار — يُعرض هنا داخل صندوق نسبي ليُرى */
  .comfort-cell { position: relative; block-size: var(--space-096);
    inline-size: var(--space-096); }
</style>
