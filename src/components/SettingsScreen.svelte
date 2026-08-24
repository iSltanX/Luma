<script lang="ts">
  import NavRow from "./NavRow.svelte";
  import SettingsRow from "./SettingsRow.svelte";
  import ThemeCard from "./ThemeCard.svelte";
  import Toggle from "./Toggle.svelte";
  import Slider from "./Slider.svelte";
  import Button from "./Button.svelte";
  import Alert from "./Alert.svelte";
  import Badge from "./Badge.svelte";
  import IconButton from "./IconButton.svelte";
  import { THEMES, type ThemeId } from "../tokens/themes";
  import { SECTIONS, type SettingsSectionId } from "../lib/settings";
  import { LIMITS, type Preferences } from "../lib/preferences.svelte";
  import { coverageBadge, coverageLabel, type FontReference } from "../lib/fonts";
  import { arabicDigits, isolate } from "../lib/bidi";

  /**
   * شاشة الإعدادات (`125:73` وما بعدها).
   *
   * «تُطبَّق التغييرات وتُحفظ فورًا؛ **لا زر «حفظ الإعدادات»**»
   * — `Luma.md` §١٥. ولذلك لا حالة معلَّقة هنا ولا تأكيد: كل عنصر
   * يستدعي `onchange` مباشرةً.
   *
   * التنقل عند بداية القراءة والمحتوى بجانبه، كما في التصميم.
   */
  let {
    prefs,
    section = "appearance",
    fonts,
    version,
    dataDir,
    onsection,
    onchange,
    onpickfont,
    onclose,
  }: {
    prefs: Preferences;
    section?: SettingsSectionId;
    fonts: readonly FontReference[];
    version: string;
    dataDir: string;
    onsection: (id: SettingsSectionId) => void;
    onchange: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
    onpickfont: () => void;
    onclose: () => void;
  } = $props();

  const current = $derived(SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]!);
  const activeFont = $derived(fonts.find((f) => f.id === prefs.fontFamily) ?? null);

  /** «الخط اختفى من النظام بعد اختياره يعود بأمان» — §٨ **ثابت**. */
  const fontMissing = $derived(
    fonts.length > 0 && !fonts.some((f) => f.id === prefs.fontFamily),
  );
</script>

<div class="screen" data-settings>
  <header class="titlebar luma-chrome" data-tauri-drag-region>
    <span class="title">الإعدادات</span>
    <div class="close">
      <IconButton name="close" label="إغلاق الإعدادات" onclick={onclose} />
    </div>
  </header>

  <div class="body">
    <nav class="nav" aria-label="أقسام الإعدادات">
      {#each SECTIONS as s (s.id)}
        <span data-section={s.id}>
          <NavRow
            label={s.label}
            icon={s.icon}
            active={section === s.id}
            onclick={() => onsection(s.id)}
          />
        </span>
      {/each}
    </nav>

    <div class="content">
      <div class="column">
        <header class="section-head">
          <h1 class="section-title">{current.label}</h1>
          <p class="section-summary">{current.summary}</p>
        </header>

        {#if section === "appearance"}
          <section class="group" aria-label="السمة">
            <h2 class="group-label">السمة</h2>
            <div class="themes">
              {#each THEMES as t (t.id)}
                <ThemeCard
                  id={t.id as ThemeId}
                  name={t.name}
                  selected={prefs.themeId === t.id}
                  onselect={(id) => onchange("themeId", id)}
                />
              {/each}
            </div>
          </section>
          <section class="group" aria-label="ملاحظة">
            <h2 class="group-label">ملاحظة</h2>
            <p class="note">
              اسم الثيم وهويته موحّدان في التصميم والكود، ويُطبَّق الاختيار
              فورًا ويُحفظ للجلسات التالية.
            </p>
          </section>

        {:else if section === "writing"}
          <section class="group" aria-label="الخط">
            <h2 class="group-label">الخط</h2>
            {#if fontMissing}
              <Alert
                kind="caution"
                title="الخط المختار لم يعد متاحًا"
                detail={`عاد النص إلى ${isolate("Almarai")}. اختر خطًّا آخر متى شئت.`}
              />
            {/if}
            <SettingsRow label="خط الكتابة" hint={activeFont?.familyName ?? prefs.fontFamily}>
              {#snippet control()}
                <div class="pair">
                  {#if activeFont}
                    <Badge kind={coverageBadge(activeFont.arabicCoverage)}>
                      {coverageLabel(activeFont.arabicCoverage)}
                    </Badge>
                  {/if}
                  <Button kind="secondary" size="sm" onclick={onpickfont} data-open-fonts>
                    تغيير
                  </Button>
                </div>
              {/snippet}
            </SettingsRow>
            <SettingsRow
              label="خط الواجهة"
              hint={`${isolate("Cairo")} — ثابت لا يتغيّر بتفضيل المستخدم`}
            >
              {#snippet control()}
                <Badge kind="neutral">غير قابل للتغيير</Badge>
              {/snippet}
            </SettingsRow>
          </section>

          <section class="group" aria-label="القياس">
            <h2 class="group-label">القياس</h2>
            <SettingsRow label="حجم النص" hint="يظهر أثره في المحرر مباشرةً">
              {#snippet control()}
                <div class="slider">
                  <Slider
                    showLabel={false}
                    value={prefs.fontSize}
                    min={LIMITS.fontSize.min}
                    max={LIMITS.fontSize.max}
                    step={LIMITS.fontSize.step}
                    label="حجم النص"
                    format={(v) => `${arabicDigits(v)} نقطة`}
                    onchange={(v) => onchange("fontSize", v)}
                  />
                </div>
              {/snippet}
            </SettingsRow>
            <SettingsRow label="تباعد الأسطر" hint="مصرَّح به لا تلقائي">
              {#snippet control()}
                <div class="slider">
                  <Slider
                    showLabel={false}
                    value={prefs.lineHeight}
                    min={LIMITS.lineHeight.min}
                    max={LIMITS.lineHeight.max}
                    step={LIMITS.lineHeight.step}
                    label="تباعد الأسطر"
                    format={(v) => `${arabicDigits(Math.round(v * 100))}٪ من حجم الخط`}
                    onchange={(v) => onchange("lineHeight", Math.round(v * 10) / 10)}
                  />
                </div>
              {/snippet}
            </SettingsRow>
            <SettingsRow label="عرض منطقة الكتابة" hint="سطر أقصر أريح للقراءة الطويلة">
              {#snippet control()}
                <div class="slider">
                  <Slider
                    showLabel={false}
                    value={prefs.columnWidth}
                    min={LIMITS.columnWidth.min}
                    max={LIMITS.columnWidth.max}
                    step={LIMITS.columnWidth.step}
                    label="عرض منطقة الكتابة"
                    format={(v) => `${arabicDigits(v)} بكسل`}
                    onchange={(v) => onchange("columnWidth", v)}
                  />
                </div>
              {/snippet}
            </SettingsRow>
          </section>

          <section class="group" aria-label="العرض">
            <h2 class="group-label">العرض</h2>
            <SettingsRow label="عدّاد الكلمات" hint="مخفي افتراضيًا">
              {#snippet control()}
                <Toggle
                  showLabel={false}
                  checked={prefs.showWordCount}
                  label="إظهار عدّاد الكلمات"
                  onchange={(v) => onchange("showWordCount", v)}
                />
              {/snippet}
            </SettingsRow>
          </section>

        {:else if section === "comfort"}
          <section class="group" aria-label="الطبقات">
            <h2 class="group-label">الطبقات</h2>
            <SettingsRow
              label="الآلة الكاتبة"
              hint="تُبقي السطر النشط في نطاق وسطي مريح"
            >
              {#snippet control()}
                <Toggle
                  showLabel={false}
                  checked={prefs.typewriterEnabled}
                  label="الآلة الكاتبة"
                  onchange={(v) => onchange("typewriterEnabled", v)}
                />
              {/snippet}
            </SettingsRow>
            <SettingsRow label="التركيز" hint="يخفت ما حول الفقرة النشطة ويبقيه مقروءًا">
              {#snippet control()}
                <Toggle
                  showLabel={false}
                  checked={prefs.focusEnabled}
                  label="التركيز"
                  onchange={(v) => onchange("focusEnabled", v)}
                />
              {/snippet}
            </SettingsRow>
            <SettingsRow
              label={isolate("Zen")}
              hint="تتراجع الواجهة أثناء الكتابة وتعود عند الحاجة"
            >
              {#snippet control()}
                <Toggle
                  showLabel={false}
                  checked={prefs.zenEnabled}
                  label={isolate("Zen")}
                  onchange={(v) => onchange("zenEnabled", v)}
                />
              {/snippet}
            </SettingsRow>
          </section>

          <section class="group" aria-label="الحركة">
            <h2 class="group-label">الحركة</h2>
            <SettingsRow
              label="تقليل الحركة"
              hint="يُضاف إلى تفضيل النظام ولا يلغيه"
            >
              {#snippet control()}
                <Toggle
                  showLabel={false}
                  checked={prefs.reduceMotionOverride}
                  label="تقليل الحركة"
                  onchange={(v) => onchange("reduceMotionOverride", v)}
                />
              {/snippet}
            </SettingsRow>
          </section>

          <section class="group" aria-label="الاختصارات">
            <h2 class="group-label">الاختصارات</h2>
            <p class="note">
              فتح المحرر المريح والخروج منه: {isolate("⌃⌘F")}. والخروج
              بـ{isolate("Esc")} كذلك. لا يعتمد الخروج على حركة المؤشر وحدها.
            </p>
          </section>

        {:else if section === "language"}
          <section class="group" aria-label="لغة الواجهة">
            <h2 class="group-label">لغة الواجهة</h2>
            <SettingsRow label="لغة الواجهة" hint="العربية">
              {#snippet control()}
                <Badge kind="accent">اللغة الوحيدة الآن</Badge>
              {/snippet}
            </SettingsRow>
            <Alert
              kind="info"
              title="العربية أولًا"
              detail={`الواجهة ${isolate("RTL")} أصيلة لا ترجمة بعد التصميم. توقيت إضافة الإنجليزية لم يُحسم بعد.`}
            />
          </section>
          <section class="group" aria-label="الأرقام والاتجاه">
            <h2 class="group-label">الأرقام والاتجاه</h2>
            <p class="note">
              تُستخدم الأرقام العربية الهندية (٠١٢) في كل نصوص الواجهة، وتبقى
              الأرقام اللاتينية للسلاسل التقنية فقط. وموضع أزرار نافذة
              {isolate("macOS")} يقرّره النظام لا {isolate("Luma")}.
            </p>
          </section>

        {:else}
          <section class="group" aria-label="التطبيق">
            <h2 class="group-label">التطبيق</h2>
            <SettingsRow label="الإصدار" hint="">
              {#snippet control()}
                <span class="value">{isolate(version)}</span>
              {/snippet}
            </SettingsRow>
            <SettingsRow label="مكان حفظ النصوص" hint="على جهازك، خارج التطبيق">
              {#snippet control()}
                <span class="value path">{isolate(dataDir)}</span>
              {/snippet}
            </SettingsRow>
          </section>
          <section class="group" aria-label="الخصوصية">
            <h2 class="group-label">الخصوصية</h2>
            <p class="note">
              يُحفظ كل نص على جهازك. لا حساب ولا مزامنة سحابية ولا تتبّع، ولا
              تُرسل نصوصك ولا خطوطك المستوردة إلى أي خدمة.
            </p>
          </section>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .screen {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: flex;
    flex-direction: column;
    background: var(--surface-canvas);
  }

  .titlebar {
    flex: none;
    display: grid;
    grid-template-columns:
      var(--size-titlebar-slot) 1fr
      var(--size-titlebar-slot);
    align-items: center;
    block-size: var(--size-titlebar);
    padding-inline: var(--space-020);
    background: var(--surface-paper);
    border-block-end: 1px solid var(--border-subtle);
  }
  .title {
    grid-column: 2;
    justify-self: center;
    font: var(--text-ui-07);
    letter-spacing: 0;
    color: var(--text-secondary);
  }
  /* الإغلاق في الطرف المقابل لأزرار النظام — القاعدة نفسها في `EditorShell` */
  .close {
    grid-column: var(--luma-status-col);
    justify-self: var(--luma-status-justify);
  }

  .body {
    flex: 1 1 auto;
    min-block-size: 0;
    display: flex;
  }

  /* التنقل عند بداية القراءة — الحافة اليمنى في RTL */
  .nav {
    flex: none;
    inline-size: 260px;
    padding: var(--space-020) var(--space-016);
    display: flex;
    flex-direction: column;
    gap: var(--space-004);
    background: var(--surface-paper);
    border-inline-end: 1px solid var(--border-subtle);
    overflow-y: auto;
  }

  .content {
    flex: 1 1 auto;
    min-inline-size: 0;
    overflow-y: auto;
    padding: var(--space-040) var(--space-048);
  }
  .column {
    /* ٧٨٠ لا ٧٠٠ كما في Figma: بطاقات الثيمات الخمس ١٤٨ لكلٍّ ومعها
       فواصلها تحتاج ٧٨٨، وفي التصميم تفيض عن العمود عمدًا. توسيعه
       أصدق من قصّ صفٍّ إلى صفّين. */
    inline-size: min(780px, 100%);
    /* محاذاة إلى بداية القراءة كما في الصفحة ١٦ لا توسيط */
    margin-inline-end: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-032);
  }

  .section-head {
    display: flex;
    flex-direction: column;
    gap: var(--space-008);
  }
  .section-title {
    font: var(--text-ui-03);
    letter-spacing: 0;
    color: var(--text-primary);
    margin: 0;
  }
  .section-summary {
    font: var(--text-ui-07);
    letter-spacing: 0;
    color: var(--text-secondary);
    margin: 0;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-008);
  }
  .group-label {
    font: var(--text-ui-09);
    letter-spacing: 0;
    color: var(--text-muted);
    margin: 0;
  }
  .note {
    font: var(--text-ui-09);
    letter-spacing: 0;
    color: var(--text-secondary);
    margin: 0;
    line-height: 1.9;
  }
  .value {
    font: var(--text-ui-09);
    letter-spacing: 0;
    color: var(--text-secondary);
  }
  /* المسار سلسلة تقنية: يُعزل اتجاهيًا ولا يُقصّ في المنتصف */
  .path {
    max-inline-size: 42ch;
    overflow-wrap: anywhere;
    display: inline-block;
    text-align: start;
  }

  .themes {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-008);
  }
  .pair {
    display: flex;
    align-items: center;
    gap: var(--space-012);
  }
  .slider {
    inline-size: 260px;
  }
</style>
