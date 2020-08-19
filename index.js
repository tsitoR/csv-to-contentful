'use strict'

var fs = require('fs');
const util = require('util');
const readFile = util.promisify(fs.readFile);
const csvtojson=require('csvtojson')

const contentful = require('contentful')
const contentfulManagement = require('contentful-management')
const chalk = require('chalk')
const Table = require('cli-table2');


var SPACE_ID
var ACCESS_TOKEN
var MANAGEMENT_ACCESS_TOKEN
var ENVIRONMENT

var client
var clientManagement

function main() {
  getFile('config-csv.json', 'utf8').then((configuration) => {
    var config = JSON.parse(configuration)
    SPACE_ID = config.spaceId
    ENVIRONMENT = config.environment 
    MANAGEMENT_ACCESS_TOKEN = config.accessToken
    ACCESS_TOKEN = config.accessToken
    client = contentful.createClient({
      space: SPACE_ID,
      accessToken: ACCESS_TOKEN
    })
    clientManagement = contentfulManagement.createClient({
      accessToken: MANAGEMENT_ACCESS_TOKEN
    })
    uploadCsv(config.file, config.imageFolder, config.locales, config.template, config.Idfield)
  })
}

function uploadCsv(file, imageFolder, locales, template, Idfield)
{
  csvtojson()
  .fromFile(file)
  .then(async (jsonObject)=>{
    await getEnvironmentFromManagement(SPACE_ID, ENVIRONMENT)
    .then(async (env) =>{
      await env.getContentType(template)
      .then(async (contentmodel) =>{
        var itrow = 0
        var itfields = 0
        var rowFields
        var newTemplate
        while(itrow<jsonObject.length)
        {
          rowFields = Object.keys(jsonObject[itrow])
          itfields = 0
          if(jsonObject[itrow][Idfield])
          {
            newTemplate = {
              id: jsonObject[itrow][Idfield].replace(/\s/g, ''),
              language: locales,
              assetFieldsIdList: [],
              item:{
                fields: {}
              }
            }
            while(itfields<rowFields.length)
            {
              if(contentmodel.fields.find( field => field.id === rowFields[itfields] && field.type === 'Link' && field.linkType === 'Asset' && jsonObject[itrow][rowFields[itfields]]))
              {
                if(fs.existsSync(imageFolder+jsonObject[itrow][rowFields[itfields]])){
                  var file = fs.readFileSync(imageFolder+jsonObject[itrow][rowFields[itfields]])
                  var title = jsonObject[itrow][rowFields[itfields]].split('.')[0]
                  var contentType = "image/"
                  contentType += jsonObject[itrow][rowFields[itfields]].split('.')[1]
                  var name = ""
                  name += jsonObject[itrow][rowFields[itfields]]
                  var itlang = 0
                  while(itlang<locales.length)
                  {
                    await env.createAssetFromFiles({
                      fields: {
                        title: {
                          [locales[itlang]]: title
                        },
                        file: {
                          [locales[itlang]]: {
                            contentType: contentType,
                            fileName: name,
                            file: file
                          }
                        }
                      }
                    })
                    .then(async (asset) =>{
                      await asset.processForAllLocales()
                      .then(async (processed) =>{
                        await processed.publish()
                        newTemplate.item.fields[rowFields[itfields]] = {}
                          newTemplate.item.fields[rowFields[itfields]][locales[itlang]] = {}
                          newTemplate.item.fields[rowFields[itfields]][locales[itlang]] = {
                            sys: {
                              type: 'Link',
                              linkType: 'Asset',
                              id: processed.sys.id
                            }
                          }
                      })
                    })
                    itlang++
                  }
                }
                if(!fs.existsSync(imageFolder+jsonObject[itrow][rowFields[itfields]])){
                  console.log("image not found: "+jsonObject[itrow][rowFields[itfields]])
                }
              }
              if(contentmodel.fields.find(field => field.id === rowFields[itfields] && !(field.type === 'Link' && field.linkType === 'Asset')))
              {
                var itlang = 0
                newTemplate.item.fields[rowFields[itfields]] = {}
                while(itlang<locales.length)
                {
                  newTemplate.item.fields[rowFields[itfields]][locales[itlang]] = {}
                  newTemplate.item.fields[rowFields[itfields]][locales[itlang]] = jsonObject[itrow][rowFields[itfields]]
                  itlang++
                }
              }
              if(!contentmodel.fields.find(field => field.id === rowFields[itfields])){
                console.log("field not found: "+rowFields[itfields])
              }
              itfields++
            }
            await createEntryWithIdFromManagement(env, template, newTemplate)
            .then(async (c) => {
              if (c.entry) {
                console.log(c.process + " Id: " + c.entry.sys.id)
                await c.entry.publish();
              }
            })
          }
          itrow++
        }
      })
    })
  })
}

function getFile(file, encodage) {
  return readFile(file, encodage)
}

/* formating and creating the assets based on the asset fields list */
async function processEntriesAsset(entry, language, baselanguage) {
  let i = 0
  while (i < entry.assetFieldsIdList.length) {
    await checkAssetIfExistsExtended(entry.item.fields[entry.assetFieldsIdList[i]].asset.fields.title[language], language, baselanguage)
      .then(async (asset) => {
        if (!asset) {
          var baselanguagealt = ""
          var languagealt = ""
          if(entry.item.fields[entry.assetFieldsIdList[i]].asset.fields.alt && entry.item.fields[entry.assetFieldsIdList[i]].asset.fields.alt[baselanguage]) baselanguagealt += entry.item.fields[entry.assetFieldsIdList[i]].asset.fields.alt[baselanguage]
          if(entry.item.fields[entry.assetFieldsIdList[i]].asset.fields.alt && entry.item.fields[entry.assetFieldsIdList[i]].asset.fields.alt[language]) languagealt += entry.item.fields[entry.assetFieldsIdList[i]].asset.fields.alt[language]
          if (language !== baselanguage) {
            var insertAsset = {
              fields: {
                title: {
                  [baselanguage]: entry.item.fields[entry.assetFieldsIdList[i]].asset.fields.title[baselanguage],
                  [language]: entry.item.fields[entry.assetFieldsIdList[i]].asset.fields.title[language]
                },
                file: {
                  [baselanguage]: entry.item.fields[entry.assetFieldsIdList[i]].asset.fields.file[baselanguage],
                  [language]: entry.item.fields[entry.assetFieldsIdList[i]].asset.fields.file[language]
                },
                description: {
                  [baselanguage]: baselanguagealt,
                  [language]: languagealt
                }
              }
            }
          }
          else {
            var insertAsset = {
              fields: {
                title: {
                  [language]: entry.item.fields[entry.assetFieldsIdList[i]].asset.fields.title[language]
                },
                file: {
                  [language]: entry.item.fields[entry.assetFieldsIdList[i]].asset.fields.file[language]
                },
                description: {
                  [language]: languagealt
                }
              }
            }
          }
          await createAssetFromManagement(SPACE_ID, ENVIRONMENT, insertAsset)
            .then((a) => {
              entry.item.fields[entry.assetFieldsIdList[i]][language] = { sys: { type: 'Link', linkType: 'Asset', id: a.sys.id } }
              return entry
            })
        }
        else {
          var validateChange = await validateImageChange(asset, entry.item.fields[entry.assetFieldsIdList[i]].asset)
          if(validateChange)
          {
            if(entry.item.fields[entry.assetFieldsIdList[i]].asset.fields.alt)
            {
              entry.item.fields[entry.assetFieldsIdList[i]].asset.fields.description = {}
              entry.item.fields[entry.assetFieldsIdList[i]].asset.fields.description = entry.item.fields[entry.assetFieldsIdList[i]].asset.fields.alt
              delete entry.item.fields[entry.assetFieldsIdList[i]].asset.fields.alt
            }
            asset.fields = entry.item.fields[entry.assetFieldsIdList[i]].asset.fields
            asset.update()
            .then(async (a) =>{
              await a.processForAllLocales()
              .then(async (r) => {
                await r.publish()
              });
            })
          }
          entry.item.fields[entry.assetFieldsIdList[i]][language] = { sys: { type: 'Link', linkType: 'Asset', id: asset.sys.id } }
          return entry
        }
      })
    i++
  }
}

// Assigning the formated asset to the corresponding field of the entry
async function formatEntriesAsset(entry) {
  var i = 0
  while (i < entry.assetFieldsIdList.length) {
    var asset = {}
    var j = 0
    while (j < entry.language.length) {
      asset[entry.language[j]] = entry.item.fields[entry.assetFieldsIdList[i]][entry.language[j]]
      j++
    }
    entry.item.fields[entry.assetFieldsIdList[i]] = {}
    entry.item.fields[entry.assetFieldsIdList[i]] = asset
    i++
  }
}

// Checking if the entry is already present by the Id
async function checkIfEntryExistById(entryId, environment, contentType) {
  return await environment.getEntry(entryId).then((entry) => {
    return entry;
  }).catch(()=>{
    return undefined;
  })
}

// Validating changes to be done on an entry
async function validateChange(entryFrom, entryTo) {
  var keys = Object.keys(entryFrom.fields)
  var keysTo = Object.keys(entryTo.item.fields)
  var i = 0
  while (i < keysTo.length) {
    if (!keys.includes(keysTo[i])) {
      return true
    }
    i++
  }
  i = 0;
  while (i < keys.length) {
    if (JSON.stringify(entryFrom.fields[keys[i]]) !== JSON.stringify(entryTo.item.fields[keys[i]])) {
      return true
    }
    i++
  }
  return false
}

// Validating changes to be done on an asset
async function validateImageChange(entryFrom, entryTo) {
  var keys = Object.keys(entryFrom.fields)
  var keysTo = Object.keys(entryTo.fields)
  var i = 0
  while (i < keysTo.length) {
    if (!keys.includes(keysTo[i])) {
      return true
    }
    i++
  }
  i = 0;
  while (i < keys.length) {
    if (JSON.stringify(entryFrom.fields[keys[i]]) !== JSON.stringify(entryTo.fields[keys[i]])) {
      return true
    }
    i++
  }
  return false
}

// processing with the entry assets
// checking if the entry is already present by the Id
// creating the entry if not present
// Updating the entry with the new one if different
// returning the entry
async function createEntryWithIdFromManagement(environment, contentType, entry) {
  return await checkIfEntryExistById(entry.id, environment, contentType).then(async (entryChecked) => {
    if (entry.assetFieldsIdList.length > 0) {
      let i = 0
      while (i < entry.language.length) {
        await processEntriesAsset(entry, entry.language[i], entry.language[0])
        i++
      }
      await formatEntriesAsset(entry)
    }
    if (entryChecked) {
      var validate = await validateChange(entryChecked, entry)
      if (validate) {
        entryChecked.fields = entry.item.fields
        return await entryChecked.update().then((entryUpdated) => {
          return {
            process: 'Updated',
            entry: entryUpdated
          };
        })
      }
      else {
        return {
          process: 'Skipped',
          entry: entryChecked
        };
      }
    }
    else {
      return await environment.createEntryWithId(contentType, entry.id, entry.item)
        .then((created) => {
          return {
            process: 'created',
            entry: created
          }
        })
    }
  })
  // return environment.createEntryWithId(contentType, entry.id, entry.item)
}

// getAssets call (returning the first 100 entries)
// and checking if the asset to create is present
// check by asset title
// check for single locale
async function checkAssetIfExists(name, language) {
  return getEnvironmentFromManagement(SPACE_ID, ENVIRONMENT)
    .then((env) => env.getAssets())
    .then((entry) => {
      var lookUp = entry.items.find((item, index) => {
        return item.fields.title[language] === name ? item : null
      })
      return lookUp
    })
    .catch((err) => console.log(err));
}

// getAssets call (returning the first 100 entries)
// and checking if the asset to create is present
// check by asset title
// check for multiple locales
async function checkAssetIfExistsExtended(name, language, baselanguage) {
  return getEnvironmentFromManagement(SPACE_ID, ENVIRONMENT)
    .then((env) => env.getAssets())
    .then((entry) => {
      if (entry.items.length > 0) {
        var lookUp = entry.items.find((item, index) => {
          if(item.fields && item.fields.title)
          {
            return item.fields.title[language] === name || item.fields.title[baselanguage] === name ? item : null
          }
        })
        return lookUp
      }
      return null;
    })
    .catch((err) => console.log(err));
}

// creating asset and processing all locales sync
async function createAssetFromManagement(SPACE_ID, ENVIRONMENT, asset) {
  return await getEnvironmentFromManagement(SPACE_ID, ENVIRONMENT)
    .then(async (env) => await env.createAsset(asset))
    .then(async (asset) => {
      return await asset.processForAllLocales()
        .then(async (r) => {
          return await r.publish()
            .then((published) => {
              return published
            })
        });
    });
}

async function createContentTypeWithIdFromManagement(environment, newContentType, Id) {
  return await environment.createContentTypeWithId(Id, newContentType)
    .then((c) => c)
    .catch((err) => console.log(err))
}

async function createContentTypeFromManagement(environment, newContentType) {
  return environment.createContentType(newContentType)
    .then((c) => c)
    .catch((err) => console.log(err))
}

// get the environment from the name and the space ID
async function getEnvironmentFromManagement(spaceid, environment) {
  return clientManagement.getSpace(spaceid)
    .then((space) => space.getEnvironment(environment))
}

async function getContentTypeFromManagement(environment, contentTypeId) {
  return clientManagement.getSpace(SPACE_ID)
    .then((space) => space.getEnvironment(environment))
    .then((environment) => environment.getContentType(contentTypeId))
    .then((contentType) => contentType)
    .catch((err) => console.log(err));
}

function updateContentTypeNameFromManagement(contentType, newName) {
  contentType.name = newName;
  contentType.status = ''
  contentType.update()
    .then((updated) => {
      console.log('Update successful')
    })
}

function displayContentTypes() {
  console.log(chalk.green('Fetching and displaying Content Types ...'))

  return fetchContentTypes()
    .then((contentTypes) => {
      // Display a table with Content Type information
      const table = new Table({
        head: ['Id', 'Title', 'Fields']
      })
      contentTypes.forEach((contentType) => {
        const fieldNames = contentType.fields
          .map((field) => field.name)
          .sort()
        table.push([contentType.sys.id, contentType.name, fieldNames.join(', ')])
      })
      console.log(table.toString())

      return contentTypes
    })
}

function displayEntries(contentTypes) {
  console.log(chalk.green('Fetching and displaying Entries ...'))

  return Promise.all(contentTypes.map((contentType) => {
    return fetchEntriesForContentType(contentType)
      .then((entries) => {
        console.log(`\These are the first 100 Entries for Content Type ${chalk.cyan(contentType.description)}:\n`)

        // Display a table with Entry information
        const table = new Table({
          head: ['Id', 'Title']
        })
        entries.forEach((entry) => {
          table.push([entry.sys.id, entry.fields[contentType.displayField] || '[empty]'])
        })
        console.log(table.toString())
      })
  }))
}

// Load all Content Types in your space from Contentful
function fetchContentTypes() {
  return client.getContentTypes()
    .then((response) => response.items)
    .catch((error) => {
      console.log(chalk.red('\nError occurred while fetching Content Types:'))
      console.error(error)
    })
}

// Load all entries for a given Content Type from Contentful
function fetchEntriesForContentType(contentType) {
  return client.getEntries({
    content_type: contentType.sys.id
  })
    .then((response) => response.items)
    .catch((error) => {
      console.log(chalk.red(`\nError occurred while fetching Entries for ${chalk.cyan(contentType.name)}:`))
      console.error(error)
    })
}

main()
