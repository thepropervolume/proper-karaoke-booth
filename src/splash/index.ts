import '@fontsource/nunito-sans/latin-400.css';
import '@fontsource/nunito-sans/latin-700.css';
import '@fontsource/nunito-sans/latin-800.css';
import dayMark from '../../assets/branding/splash/karabooth-mark-day.svg';
import nightMark from '../../assets/branding/splash/karabooth-mark-night.svg';
import './splash.css';

const day = new URLSearchParams(location.search).get('theme') === 'day';
document.documentElement.dataset.theme = day ? 'day' : 'night';
document.querySelector<HTMLImageElement>('.mark')!.src = day ? dayMark : nightMark;
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !event.repeat) {
    event.preventDefault();
    document.querySelector<HTMLAnchorElement>('.quit')?.click();
  }
});
