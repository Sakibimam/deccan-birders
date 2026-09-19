/** Asserts js-sha3 (used in the browser) and bee-js derive the SAME feed topic. */
import pkg from 'js-sha3'
import { Topic } from '@ethersphere/bee-js'
const { keccak256 } = pkg
const t = process.argv[2] ?? 'deccan-birders-sightings-v1'
const a = keccak256(t)
const b = Topic.fromString(t).toHex()
console.log('js-sha3 keccak256 :', a)
console.log('bee-js  Topic     :', b)
const same = a === b
console.log(same ? '\nIDENTICAL — filer, reader and seed all resolve the same feed'
                 : '\nMISMATCH — they would look at different feeds')
process.exit(same ? 0 : 1)
