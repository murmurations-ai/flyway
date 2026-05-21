import { describe, expect, it } from 'vitest'
import { flywayInit } from './init.js'
import {
  fingerprintEntityStatement,
  peerCachePathSegments,
  recognizePeer,
  verifyRecognitionEntry,
} from './recognize.js'
import { DOMAIN_RECOGNITION, localEd25519Signer } from './signing.js'

async function makeMurmuration(owner: string, name: string, sourceName: string) {
  const artifacts = await flywayInit({
    repoUrl: `https://github.com/${owner}/${name}`,
    sourceName,
    mode: 'interactive',
  })
  const signer = localEd25519Signer({
    privateKeyPem: artifacts.keypair.privateKeyPem,
    publicKeyJwk: artifacts.keypair.publicKeyJwk,
    verificationKeyId: `${artifacts.did}#key-1`,
  })
  return { artifacts, signer }
}

describe('recognizePeer', () => {
  it('produces a signed recognition entry binding peer identity at fingerprint time', async () => {
    const A = await makeMurmuration('xeeban', 'flyway', 'Nori')
    const B = await makeMurmuration('emergent', 'praxis', 'Praxis Source')
    const { entry, peerSignatureValid } = await recognizePeer({
      peerDidDocument: B.artifacts.didDocument,
      peerEntityStatement: B.artifacts.entityStatement,
      recognizedByDid: A.artifacts.did,
      signer: A.signer,
    })
    expect(peerSignatureValid).toBe(true)
    expect(entry.did).toBe(B.artifacts.did)
    expect(entry.sourceName).toBe('Praxis Source')
    expect(entry.recognizedBy).toBe(A.artifacts.did)
    expect(entry.entityStatementFingerprint).toBe(
      fingerprintEntityStatement(B.artifacts.entityStatement),
    )
    expect(entry.signature.algorithm).toBe('EdDSA')
    expect(entry.signature.domain).toBe(DOMAIN_RECOGNITION)
    expect(entry.signature.verificationKeyId).toBe(`${A.artifacts.did}#key-1`)
  })

  it('records an optional note when provided', async () => {
    const A = await makeMurmuration('xeeban', 'a', 'Nori')
    const B = await makeMurmuration('xeeban', 'b', 'Other')
    const { entry } = await recognizePeer({
      peerDidDocument: B.artifacts.didDocument,
      peerEntityStatement: B.artifacts.entityStatement,
      recognizedByDid: A.artifacts.did,
      signer: A.signer,
      note: 'Met via S3 walkthrough 2026-05-13',
    })
    expect(entry.note).toBe('Met via S3 walkthrough 2026-05-13')
  })

  it('refuses to recognize an unverifiable peer (tampered entity statement)', async () => {
    const A = await makeMurmuration('xeeban', 'a', 'Nori')
    const B = await makeMurmuration('xeeban', 'b', 'Other')
    const tampered = { ...B.artifacts.entityStatement, sourceName: 'Imposter' }
    await expect(
      recognizePeer({
        peerDidDocument: B.artifacts.didDocument,
        peerEntityStatement: tampered,
        recognizedByDid: A.artifacts.did,
        signer: A.signer,
      }),
    ).rejects.toThrow(/does not verify/)
  })

  it('refuses to recognize when peer DID document and statement disagree', async () => {
    const A = await makeMurmuration('xeeban', 'a', 'Nori')
    const B = await makeMurmuration('xeeban', 'b', 'Other')
    const C = await makeMurmuration('xeeban', 'c', 'Mismatched')
    await expect(
      recognizePeer({
        peerDidDocument: B.artifacts.didDocument, // B's doc
        peerEntityStatement: C.artifacts.entityStatement, // C's statement
        recognizedByDid: A.artifacts.did,
        signer: A.signer,
      }),
    ).rejects.toThrow(/peer DID mismatch|does not verify/)
  })

  it('refuses to recognize self', async () => {
    const A = await makeMurmuration('xeeban', 'a', 'Nori')
    await expect(
      recognizePeer({
        peerDidDocument: A.artifacts.didDocument,
        peerEntityStatement: A.artifacts.entityStatement,
        recognizedByDid: A.artifacts.did,
        signer: A.signer,
      }),
    ).rejects.toThrow(/cannot recognize self/)
  })

  it('the resulting entry verifies against the recognizing Source DID document', async () => {
    const A = await makeMurmuration('xeeban', 'a', 'Nori')
    const B = await makeMurmuration('xeeban', 'b', 'Other')
    const { entry } = await recognizePeer({
      peerDidDocument: B.artifacts.didDocument,
      peerEntityStatement: B.artifacts.entityStatement,
      recognizedByDid: A.artifacts.did,
      signer: A.signer,
    })
    const ok = await verifyRecognitionEntry(entry, A.artifacts.didDocument)
    expect(ok).toBe(true)
  })

  it('an entry does NOT verify against an unrelated DID document', async () => {
    const A = await makeMurmuration('xeeban', 'a', 'Nori')
    const B = await makeMurmuration('xeeban', 'b', 'Other')
    const C = await makeMurmuration('xeeban', 'c', 'Third')
    const { entry } = await recognizePeer({
      peerDidDocument: B.artifacts.didDocument,
      peerEntityStatement: B.artifacts.entityStatement,
      recognizedByDid: A.artifacts.did,
      signer: A.signer,
    })
    const ok = await verifyRecognitionEntry(entry, C.artifacts.didDocument)
    expect(ok).toBe(false)
  })
})

describe('peerCachePathSegments', () => {
  it('maps did:web to host/owner/repo segments', () => {
    const segs = peerCachePathSegments('did:web:github.com:xeeban:flyway')
    expect(segs).toEqual(['github.com', 'xeeban', 'flyway'])
  })

  it('rejects non-did:web DIDs', () => {
    expect(() => peerCachePathSegments('did:cardano:abc')).toThrow(/only did:web/)
  })

  it('rejects DIDs with no path components', () => {
    expect(() => peerCachePathSegments('did:web:example.com')).toThrow(/path components/)
  })
})
