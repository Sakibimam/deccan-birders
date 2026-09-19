import { Topic } from '@ethersphere/bee-js'
const t = process.argv[2] ?? 'deccan-birders-sightings-v1'
console.log(`topic string : ${t}`)
console.log(`topic hex    : ${Topic.fromString(t).toHex()}`)
