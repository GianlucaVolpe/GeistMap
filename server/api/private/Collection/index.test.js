const neo4j = require('neo4j-driver').v1
const elasticsearch = require('elasticsearch')
const ObjectID = require('mongodb').ObjectID

const uuidV4 = require('uuid/v4');
jest.mock('uuid/v4')
const uuidV4Actual = require.requireActual('uuid/v4');

const createCollectionApi = require('./index.js')
const config = require('../../../config/test.config.js')

const {
    sortById,
    sortByStart,
    getUserGraphData,
    loadFixtures,
} = require('../../test/util')

const userId = new ObjectID()
const rootCollectionId = "__TEST__123456789"
// id is all the API needs to know
const user = {
    _id: userId,
}
let collectionApi, db, es;


describe('collectionApi', () => {
    beforeAll(() => {
        const driver = neo4j.driver(
            config.neo4j.url,
            neo4j.auth.basic(config.neo4j.user, config.neo4j.password),
            {
                convertToString: true
            }
        )

        db = driver.session();
        es = elasticsearch.Client({
            host: 'http://localhost:9200',
            log: [{
                type: 'stdio',
                levels: ['error', 'warning']
            }]
        })

        collectionApi = createCollectionApi(db, es)
    })

    afterEach(() => {
        // cleanup
        db.run(`
                MATCH (u:User)-[*]-(n) WHERE u.id = "${userId.toString()}"
                DETACH DELETE u
                DETACH DELETE n
                `)
    })

    test('test createRootCollection', async () => {
        /*
         * 1. Should create the User object since it doesn't exist yet
         * 2. Should create the root collection
         */

        const id = "abc"
        uuidV4.mockImplementationOnce(() => id)

        const result = await collectionApi.createRootCollection(user)
        const graphState = await getUserGraphData(db, userId)

        expect(graphState).toMatchObject({
            nodes: [
                {
                    properties: {
                        name: 'My Knowledge Base',
                        // modified: '1503323527535',
                        id: 'abc',
                        type: 'root',
                        isRootCollection: true,
                        // created: '1503323527535'
                    },
                    labels: [ 'RootCollection', 'Collection' ]
                }
            ],
            edges: [
                {
                    type: 'AUTHOR',
                    properties: {}
                }
            ]
        })
    })

    test('test Collection.create() correctly creates a collection', () => {
        // TODO: Also test full-text indexing occurs

        const id = uuidV4Actual()
        const edgeId = uuidV4Actual()
        const parentId = uuidV4Actual()
        const node = {
            "name": "wowzers"
        }
        uuidV4.mockImplementationOnce(() => edgeId)

        return loadFixtures(db, userId.toString(), [
            {
                labels: [ "Collection", "RootCollection" ],
                properties: {
                    "isRootCollection": true,
                    "created": 1503389225848,
                    "name": "My Knowledge Base",
                    "modified": 1503389225848,
                    "id": parentId,
                    "type": "root"
                }
            }
        ])
            .then(() => {
                return collectionApi.create(user, id, parentId, node)
            })
            .then((result) => {
                // test the immediate result returns the node and edge
                expect(result).toMatchObject({
                    name: "wowzers",
                    id: id,
                    type: "collection",
                })

                return getUserGraphData(db, userId)
            })
            .then((result) => {
                // test the final state is as expected
                // TODO: test final state is as expected
            })
    })

    test("Collection.connect() works properly", () => {
        const edgeId = uuidV4Actual()
        const sourceId = uuidV4Actual()
        const targetId = uuidV4Actual()

        return loadFixtures(db, userId.toString(), [
            {
                labels: [ "Collection", "Node" ],
                properties: {
                    "name": "Source collection",
                    "id": sourceId,
                    "type": "collection"
                }
            },
            {
                labels: [ "Collection", "Node" ],
                properties: {
                    "name": "Target collection",
                    "id": targetId,
                    "type": "collection"
                }
            },
        ])
            .then(() => {
                return collectionApi.connect(user, sourceId, targetId, edgeId)
                    .then((result) => {
                        return result
                    })
            })
            .then((result) => {
                // expect result to return the edge
                expect(result).toMatchObject({
                    start: sourceId,
                    end: targetId,
                    id: edgeId,
                })

                return getUserGraphData(db, userId)
            })
            .then((graphState) => {
                // test if graph state is as expected
                expect(sortById(graphState.nodes)).toMatchObject(sortById([
                    {
                        properties: {
                            name: 'Source collection',
                            type: 'collection',
                            id: sourceId,
                        },
                        labels: [ 'Collection', 'Node' ]
                    },
                    {
                        properties: {
                            name: 'Target collection',
                            type: 'collection',
                            id: targetId,
                        },
                        labels: [ 'Collection', 'Node' ]
                    },
                    {
                        properties: {
                            id: userId.toString(),
                        },
                        labels: [ 'User' ]
                    }
                ]))

                expect(sortById(graphState.edges)).toMatchObject(sortById([
                    {
                        type: 'AUTHOR',
                        properties: {}
                    },
                    {
                        type: 'AUTHOR',
                        properties: {}
                    },
                    {
                        properties: {
                            end: targetId,
                            start: sourceId,
                            id: edgeId,
                        },
                        type: "AbstractEdge"
                    }
                ]))
            })
    })

    test("Impossible to remove RootCollection", () => {
        return loadFixtures(db, userId.toString(), [
            {
                properties: {
                    name: 'My Knowledge Base',
                    id: 'TEST__rootCollection',
                    type: 'root',
                    isRootCollection: true,
                },
                labels: [ 'RootCollection', 'Collection' ]
            },
        ])
            .then(() => {
                return collectionApi.remove(user, "TEST__rootCollection")
            })
            .then((result) => {
                return getUserGraphData(db, userId)
            })
            .then((graphState) => {
                // console.log(require('util').inspect(graphState, false, null))
                expect(sortById(graphState.nodes)).toMatchObject(sortById([
                    {
                        properties: {
                            name: 'My Knowledge Base',
                            id: 'TEST__rootCollection',
                            type: 'root',
                            isRootCollection: true,
                        },
                        labels: [ 'RootCollection', 'Collection' ]
                    },
                ]))

                expect(sortById(graphState.edges)).toMatchObject(sortById([
                    {
                        type: 'AUTHOR',
                        properties: {}
                    },
                ]))
            })
    })

    test("Collection.remove() converts the abstraction to a node", () => {

        return loadFixtures(db, userId.toString(), [
            {
                properties: {
                    name: 'My Knowledge Base',
                    id: 'TEST__rootCollection',
                    type: 'root',
                    isRootCollection: true,
                },
                labels: [ 'RootCollection', 'Collection' ]
            },
            {
                labels: [ "Collection", "Node" ],
                properties: {
                    "name": "Collection",
                    "id": "TEST__collection",
                    "type": "collection"
                }
            }
        ], [
            {
                properties: {
                    end: "TEST__rootCollection",
                    start: "TEST__collection",
                    id: "TEST__collection_rootCollection",
                },
                type: "AbstractEdge"
            }
        ])
            .then(() => {
                return collectionApi.remove(user, "TEST__collection")
            })
            .then((result) => {
                // expect result to return true
                expect(result).toBe(true)
                return getUserGraphData(db, userId)
            })
            .then((graphState) => {
                // TODO: instead compare using the original object

                expect(sortById(graphState.nodes)).toMatchObject(sortById([
                    {
                        properties: {
                            name: 'My Knowledge Base',
                            id: 'TEST__rootCollection',
                            type: 'root',
                            isRootCollection: true,
                        },
                        labels: [ 'RootCollection', 'Collection' ]
                    },
                    {
                        labels: [ "Node" ], // this was removed
                        properties: {
                            "name": "Collection",
                            "id": "TEST__collection",
                            "type": "node"
                        }
                    },
                    {
                        properties: {
                            id: userId.toString(),
                        },
                        labels: [ 'User' ]
                    }
                ], [
                    {
                        properties: {
                            end: "TEST__rootCollection",
                            start: "TEST__collection",
                            id: "TEST__collection_rootCollection",
                        },
                        type: "AbstractEdge"
                    }
                ]))

                expect(sortById(graphState.edges)).toMatchObject(sortById([
                    {
                        type: 'AUTHOR',
                        properties: {}
                    },
                    {
                        type: 'AUTHOR',
                        properties: {}
                    },
                    {
                        properties: {
                            end: "TEST__rootCollection",
                            start: "TEST__collection",
                            id: "TEST__collection_rootCollection",
                        },
                        type: "AbstractEdge"
                    }
                ]))
            })


    })

    test("Collection.remove() removes the collection and attaches the child nodes to the parent collection", () => {
        return loadFixtures(db, userId.toString(), [
            {
                properties: {
                    name: 'My Knowledge Base',
                    id: 'TEST__rootCollection',
                    type: 'root',
                    isRootCollection: true,
                },
                labels: [ 'RootCollection', 'Collection' ]
            },
            {
                labels: [ "Collection", "Node" ],
                properties: {
                    "name": "Collection",
                    "id": "TEST__collection",
                    "type": "collection"
                }
            },
            {
                labels: [ "Node" ],
                properties: {
                    "name": "Node1",
                    "id": "TEST__node1",
                    "type": "node"
                }
            },
            {
                labels: [ "Node" ],
                properties: {
                    "name": "Node2",
                    "id": "TEST__node2",
                    "type": "node"
                }
            },
        ], [
            {
                properties: {
                    end: "TEST__rootCollection",
                    start: "TEST__collection",
                    id: "TEST__collection_rootCollection",
                },
                type: "AbstractEdge"
            },
            {
                properties: {
                    end: "TEST__collection",
                    start: "TEST__node1",
                    id: "TEST__node1_collection",
                },
                type: "AbstractEdge"
            },
            {
                properties: {
                    end: "TEST__collection",
                    start: "TEST__node2",
                    id: "TEST__node2_collection",
                },
                type: "AbstractEdge"
            },
        ])
            .then(() => {
                return collectionApi.remove(user, "TEST__collection")
            })
            .then((result) => {
                // expect result to return true
                expect(result).toBe(true)
                return getUserGraphData(db, userId)
            })
            .then((graphState) => {
                // TODO: instead compare using the original object

                expect(sortById(graphState.nodes)).toMatchObject(sortById([
                    {
                        properties: {
                            name: 'My Knowledge Base',
                            id: 'TEST__rootCollection',
                            type: 'root',
                            isRootCollection: true,
                        },
                        labels: [ 'RootCollection', 'Collection' ]
                    },
                    {
                        labels: [ "Node" ], // this was removed
                        properties: {
                            "name": "Collection",
                            "id": "TEST__collection",
                            "type": "node"
                        }
                    },
                    {
                        labels: [ "Node" ],
                        properties: {
                            "name": "Node1",
                            "id": "TEST__node1",
                            "type": "node"
                        }
                    },
                    {
                        labels: [ "Node" ],
                        properties: {
                            "name": "Node2",
                            "id": "TEST__node2",
                            "type": "node"
                        }
                    },
                    {
                        properties: {
                            id: userId.toString(),
                        },
                        labels: [ 'User' ]
                    }
                ]))

                // TODO: need to know the id for the edge, but is created in neo4j
                expect(sortByStart(graphState.edges)).toMatchObject(sortByStart([
                    {
                        type: 'AUTHOR',
                        properties: {}
                    },
                    {
                        type: 'AUTHOR',
                        properties: {}
                    },
                    {
                        type: 'AUTHOR',
                        properties: {}
                    },
                    {
                        type: 'AUTHOR',
                        properties: {}
                    },
                    {
                        properties: {
                            end: "TEST__rootCollection",
                            start: "TEST__collection",
                            id: "TEST__collection_rootCollection",
                        },
                        type: "AbstractEdge"
                    },
                    {
                        properties: {
                            end: "TEST__rootCollection",
                            start: "TEST__node1",
                        },
                        type: "AbstractEdge"
                    },
                    {
                        properties: {
                            end: "TEST__rootCollection",
                            start: "TEST__node2",
                        },
                        type: "AbstractEdge"
                    },
                ]))
            })
    })


    test("test Collection.addNode() correctly called", () => {
        return loadFixtures(db, userId.toString(), [
            {
                properties: {
                    name: 'My Knowledge Base',
                    id: 'TEST__rootCollection',
                    type: 'root',
                    isRootCollection: true,
                },
                labels: [ 'RootCollection', 'Collection' ]
            },
            {
                labels: [ "Collection", "Node" ],
                properties: {
                    "name": "Collection",
                    "id": "TEST__collection",
                    "type": "collection"
                }
            },
            {
                labels: [ "Node" ],
                properties: {
                    "name": "Node",
                    "id": "TEST__node",
                    "type": "node"
                }
            }
        ], [
            {
                properties: {
                    end: "TEST__rootCollection",
                    start: "TEST__collection",
                    id: "TEST__collection_rootCollection",
                },
                type: "AbstractEdge"
            },
            {
                properties: {
                    end: "TEST__rootCollection",
                    start: "TEST__node",
                    id: "TEST__node_rootCollection",
                },
                type: "AbstractEdge"
            },

        ])
            .then(() => {
                return collectionApi.addNode(user, "TEST__collection", "TEST__node", "TEST__node_collection")
            })
            .then((result) => {
                // expect result to return true
                expect(result).toMatchObject({
                    start: "TEST__node",
                    end: "TEST__collection",
                    id: "TEST__node_collection",
                })
                return getUserGraphData(db, userId)
            })
            .then((graphState) => {
                // TODO: instead compare using the original object

                expect(sortById(graphState.nodes)).toMatchObject(sortById([
                    {
                        properties: {
                            name: 'My Knowledge Base',
                            id: 'TEST__rootCollection',
                            type: 'root',
                            isRootCollection: true,
                        },
                        labels: [ 'RootCollection', 'Collection' ]
                    },
                    {
                        labels: [ "Collection", "Node" ],
                        properties: {
                            "name": "Collection",
                            "id": "TEST__collection",
                            "type": "collection"
                        }
                    },
                    {
                        labels: [ "Node" ],
                        properties: {
                            "name": "Node",
                            "id": "TEST__node",
                            "type": "node"
                        }
                    },
                    {
                        properties: {
                            id: userId.toString(),
                        },
                        labels: [ 'User' ]
                    }
                ]))

                expect(sortById(graphState.edges)).toMatchObject(sortById([
                    {
                        type: 'AUTHOR',
                        properties: {}
                    },
                    {
                        type: 'AUTHOR',
                        properties: {}
                    },
                    {
                        type: 'AUTHOR',
                        properties: {}
                    },
                    {
                        properties: {
                            end: "TEST__rootCollection",
                            start: "TEST__collection",
                            id: "TEST__collection_rootCollection",
                        },
                        type: "AbstractEdge"
                    },
                    {
                        properties: {
                            end: "TEST__rootCollection",
                            start: "TEST__node",
                            id: "TEST__node_rootCollection",
                        },
                        type: "AbstractEdge"
                    },
                    {
                        properties: {
                            end: "TEST__collection",
                            start: "TEST__node",
                            id: "TEST__node_collection",
                        },
                        type: "AbstractEdge"
                    },
                ]))
            })
    })


    test("test Collection.removeNode() correctly called", () => {
        return loadFixtures(db, userId.toString(), [
            {
                properties: {
                    name: 'My Knowledge Base',
                    id: 'TEST__rootCollection',
                    type: 'root',
                    isRootCollection: true,
                },
                labels: [ 'RootCollection', 'Collection' ]
            },
            {
                labels: [ "Collection", "Node" ],
                properties: {
                    "name": "Collection",
                    "id": "TEST__collection",
                    "type": "collection"
                }
            },
            {
                labels: [ "Node" ],
                properties: {
                    "name": "Node",
                    "id": "TEST__node",
                    "type": "node"
                }
            }
        ], [
            {
                properties: {
                    end: "TEST__rootCollection",
                    start: "TEST__collection",
                    id: "TEST__collection_rootCollection",
                },
                type: "AbstractEdge"
            },
            {
                properties: {
                    end: "TEST__collection",
                    start: "TEST__node",
                    id: "TEST__node_collection",
                },
                type: "AbstractEdge"
            },

        ])
            .then(() => {
                return collectionApi.removeNode(user, "TEST__collection", "TEST__node")
            })
            .then((result) => {
                expect(result).toBe(true)
                return getUserGraphData(db, userId)
            })
            .then((graphState) => {
                // TODO: instead compare using the original object
                expect(sortById(graphState.nodes)).toMatchObject(sortById([
                    {
                        properties: {
                            name: 'My Knowledge Base',
                            id: 'TEST__rootCollection',
                            type: 'root',
                            isRootCollection: true,
                        },
                        labels: [ 'RootCollection', 'Collection' ]
                    },
                    {
                        labels: [ "Collection", "Node" ],
                        properties: {
                            "name": "Collection",
                            "id": "TEST__collection",
                            "type": "collection"
                        }
                    },
                    {
                        labels: [ "Node" ],
                        properties: {
                            "name": "Node",
                            "id": "TEST__node",
                            "type": "node"
                        }
                    },
                    {
                        properties: {
                            id: userId.toString(),
                        },
                        labels: [ 'User' ]
                    }
                ]))

                expect(sortById(graphState.edges)).toMatchObject(sortById([
                    {
                        type: 'AUTHOR',
                        properties: {}
                    },
                    {
                        type: 'AUTHOR',
                        properties: {}
                    },
                    {
                        type: 'AUTHOR',
                        properties: {}
                    },
                    {
                        properties: {
                            end: "TEST__rootCollection",
                            start: "TEST__collection",
                            id: "TEST__collection_rootCollection",
                        },
                        type: "AbstractEdge"
                    },
                ]))
            })
    })

    test("Collection.moveNode() should move the node from the source collection to the target collection", () => {
        return loadFixtures(db, userId.toString(), [
            {
                properties: {
                    name: 'My Knowledge Base',
                    id: 'TEST__rootCollection',
                    type: 'root',
                    isRootCollection: true,
                },
                labels: [ 'RootCollection', 'Collection' ]
            },
            {
                labels: [ "Collection", "Node" ],
                properties: {
                    "name": "Collection",
                    "id": "TEST__collection",
                    "type": "collection"
                }
            },
            {
                labels: [ "Node" ],
                properties: {
                    "name": "Node",
                    "id": "TEST__node",
                    "type": "node"
                }
            }
        ], [
            {
                properties: {
                    end: "TEST__rootCollection",
                    start: "TEST__collection",
                    id: "TEST__collection_rootCollection",
                },
                type: "AbstractEdge"
            },
            {
                properties: {
                    end: "TEST__rootCollection",
                    start: "TEST__node",
                    id: "TEST__node_rootCollection",
                },
                type: "AbstractEdge"
            },

        ])
            .then(() => {
                return collectionApi.moveNode(user,
                    "TEST__rootCollection",
                    "TEST__node",
                    "TEST__collection",
                    "TEST__node_collection",
                )
            })
            .then((result) => {
                // expect result to return true
                expect(result).toMatchObject({
                    start: "TEST__node",
                    end: "TEST__collection",
                    id: "TEST__node_collection",
                })
                return getUserGraphData(db, userId)
            })
            .then((graphState) => {
                // TODO: instead compare using the original object

                expect(sortById(graphState.nodes)).toMatchObject(sortById([
                    {
                        properties: {
                            name: 'My Knowledge Base',
                            id: 'TEST__rootCollection',
                            type: 'root',
                            isRootCollection: true,
                        },
                        labels: [ 'RootCollection', 'Collection' ]
                    },
                    {
                        labels: [ "Collection", "Node" ],
                        properties: {
                            "name": "Collection",
                            "id": "TEST__collection",
                            "type": "collection"
                        }
                    },
                    {
                        labels: [ "Node" ],
                        properties: {
                            "name": "Node",
                            "id": "TEST__node",
                            "type": "node"
                        }
                    },
                    {
                        properties: {
                            id: userId.toString(),
                        },
                        labels: [ 'User' ]
                    }
                ]))

                expect(sortById(graphState.edges)).toMatchObject(sortById([
                    {
                        type: 'AUTHOR',
                        properties: {}
                    },
                    {
                        type: 'AUTHOR',
                        properties: {}
                    },
                    {
                        type: 'AUTHOR',
                        properties: {}
                    },
                    {
                        properties: {
                            end: "TEST__rootCollection",
                            start: "TEST__collection",
                            id: "TEST__collection_rootCollection",
                        },
                        type: "AbstractEdge"
                    },
                    {
                        properties: {
                            end: "TEST__collection",
                            start: "TEST__node",
                            id: "TEST__node_collection",
                        },
                        type: "AbstractEdge"
                    },
                ]))
            })
    })
})
