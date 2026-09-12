import type { ActivityDefinition, ConceptTag, Stage } from '../problems/contracts/spatial.ts';
export interface LessonDefinition {
 curriculumVersion:'spatial-v2';lessonId:number;title:string;objective:string;
 stages:{stage:Stage;label:string;required:boolean}[];
 activities:ActivityDefinition[];
 assessment:{commonCount:number;adaptiveCount:number;selection:'concept-tag-errors'};
 practice:{requiredCount:number;optionalCount:number};
 conceptTags:ConceptTag[];
}
