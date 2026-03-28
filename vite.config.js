import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/Meal_planer/', // TO JEST KLUCZOWE: nazwa Twojego repozytorium
})