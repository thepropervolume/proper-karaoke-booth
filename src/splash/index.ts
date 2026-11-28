import '@fontsource/nunito-sans/latin-400.css';
import '@fontsource/nunito-sans/latin-700.css';
import '@fontsource/nunito-sans/latin-800.css';
import dayMark from '../../assets/branding/splash/karabooth-mark-day.svg';
import nightMark from '../../assets/branding/splash/karabooth-mark-night.svg';
import './splash.css';

const day = new URLSearchParams(location.search).get('theme') === 'day';
document.documentElement.dataset.theme = day ? 'day' : 'night';
document.querySelector<HTMLImageElement>('.mark')!.src = day ? dayMark : nightMark;
const licenseHelp = document.querySelector<HTMLElement>('.license-help')!;
const resetLicenseDismissal = () => { delete licenseHelp.dataset.dismissed; };
licenseHelp.addEventListener('pointerenter', resetLicenseDismissal);
licenseHelp.addEventListener('focusin', resetLicenseDismissal);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !event.repeat) {
    event.preventDefault();
    if (!licenseHelp.hasAttribute('data-dismissed') && licenseHelp.matches(':hover, :focus-within')) {
      licenseHelp.dataset.dismissed = 'true';
      return;
    }
    document.querySelector<HTMLAnchorElement>('.quit')?.click();
  }
});
