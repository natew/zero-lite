import { Slot } from 'one'
import { ProvideZero } from '~/zero/client'

export default function Layout() {
  return (
    <ProvideZero>
      <Slot />
    </ProvideZero>
  )
}
