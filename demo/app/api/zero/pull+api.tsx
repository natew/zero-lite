import { zeroServer } from '~/zero/server'
import type { Endpoint } from 'one'

export const POST: Endpoint = async (request) => {
  try {
    const { response } = await zeroServer.handleQueryRequest({
      authData: null,
      request,
    })
    return Response.json(response)
  } catch (err) {
    console.error(`[zero] pull error`, err)
    return Response.json({ err }, { status: 500 })
  }
}
