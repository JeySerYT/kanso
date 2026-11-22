import { applyStaticTranslations, currentLocale, useLanguage } from '../i18n.js'
import {
  composeDialog,
  composeProject,
  connectionEl,
  deleteDialog,
  filterLabel,
  filters,
  languageSelect,
  paletteDialog,
  setConnection,
  taskDialog,
} from './core.js'
import { render, resetColumns } from './board.js'
import { populateComposeProjects, renderLabelPicker } from './compose.js'
import { getCurrentTaskId, openTask, refreshDeleteText } from './drawer.js'
import { renderPalette } from './palette.js'

export async function changeLanguage(next) {
  await useLanguage(next)
  languageSelect.value = currentLocale()
  applyStaticTranslations()
  // applyStaticTranslations возвращает текст соединения к начальному ключу:
  // восстанавливаем фактическое состояние канала.
  setConnection(connectionEl.classList.contains('is-live'))

  resetColumns()
  filters.dataset.signature = ''
  filterLabel.dataset.signature = ''
  render()

  if (taskDialog.open && getCurrentTaskId()) {
    await openTask(getCurrentTaskId())
  } else if (composeDialog.open) {
    renderLabelPicker()
    populateComposeProjects(composeProject.value)
  }
  if (deleteDialog.open) refreshDeleteText()
  if (paletteDialog.open) renderPalette()
}