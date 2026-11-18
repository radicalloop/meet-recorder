import type { MeetApi } from '../shared/types'

declare global {
  interface Window {
    meet: MeetApi
  }
}
